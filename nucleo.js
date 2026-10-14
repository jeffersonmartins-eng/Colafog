/**
 * COLAFOG – regras de gravação (sem dependência do Google; testável fora do Apps Script).
 *
 * Colunas A..Q da aba "Lançamentos" (índice 0-based):
 */
var COL = {
  ID: 0, REGISTRADO_EM: 1, REGISTRADO_POR: 2, EQUIPE: 3, TENTATIVA: 4, RESULTADO: 5,
  ABORTO: 6, ALCANCE: 7, INF_EPI: 8, INF_MAO: 9, INF_ESPEQUE: 10, INF_GATILHO: 11,
  FRASCOS: 12, MOTIVO: 13, OBS: 14, SITUACAO: 15, SUBSTITUI: 16
};
var N_COLS_ENTRADA = 17;
var RESULTADOS = ['Lançado', 'Não lançado', 'Desclassificada'];

/**
 * Decide o que fazer com um registro vindo do app.
 * @param {Array<Array>} linhas  linhas atuais (A..Q) da aba Lançamentos, sem cabeçalho
 * @param {Object} rec           registro do app
 * @param {Object} ctx           {equipes: {codigo: true}, nLanc: 2, agora: Date}
 * @return {Object} {status, msg, nova: Array|null, alteracoes: [{linha, col, valor}], hist: [..]}
 *   status: ok | repetido | conflito | erro
 */
function decidirRegistro(linhas, rec, ctx) {
  var res = { status: 'ok', msg: '', nova: null, alteracoes: [], hist: [] };
  var id = String(rec.id || '').trim();
  if (!id) return erro_('Registro sem ID.');

  // 1. Idempotência: o mesmo ID pode chegar duas vezes (fila offline reenviando).
  for (var i = 0; i < linhas.length; i++) {
    if (String(linhas[i][COL.ID]) === id) {
      res.status = 'repetido'; res.msg = 'Já estava gravado.'; return res;
    }
  }

  var acao = rec.acao || 'registrar';   // registrar | corrigir | anular

  // 2. Anular: marca a linha alvo como ANULADO (não cria lançamento).
  if (acao === 'anular') {
    var alvoA = acharLinha_(linhas, rec.substitui);
    if (alvoA < 0) return erro_('Registro a anular não encontrado: ' + rec.substitui);
    res.alteracoes.push({ linha: alvoA, col: COL.SITUACAO, valor: 'ANULADO' });
    res.hist.push(hist_(ctx, 'ANULAÇÃO', rec, linhas[alvoA], 'Anulou ' + rec.substitui + (rec.obs ? ' – ' + rec.obs : '')));
    res.msg = 'Registro anulado.';
    return res;
  }

  // 3. Validação
  var equipe = String(rec.equipe || '').trim().toUpperCase();
  var tentativa = Number(rec.tentativa);
  if (!ctx.equipes[equipe]) return erro_('Equipe não cadastrada: ' + equipe);
  if (!(tentativa >= 1 && tentativa <= ctx.nLanc && Math.floor(tentativa) === tentativa))
    return erro_('Tentativa inválida: ' + rec.tentativa);
  if (RESULTADOS.indexOf(rec.resultado) < 0) return erro_('Resultado inválido: ' + rec.resultado);
  var alcance = '';
  if (rec.resultado === 'Lançado') {
    alcance = Number(String(rec.alcance).replace(',', '.'));
    if (rec.alcance === '' || rec.alcance === null || rec.alcance === undefined || isNaN(alcance) || alcance < 0 || alcance > 1000)
      return erro_('Alcance inválido: ' + rec.alcance);
  }
  if (rec.resultado === 'Desclassificada' && !rec.motivo) return erro_('Desclassificação sem motivo.');

  var inf = rec.infracoes || {};
  var sn = function (v) { return v ? 'Sim' : 'Não'; };
  var nova = new Array(N_COLS_ENTRADA);
  nova[COL.ID] = id;
  nova[COL.REGISTRADO_EM] = rec.registradoEm ? new Date(rec.registradoEm) : ctx.agora;
  nova[COL.REGISTRADO_POR] = String(rec.por || '').slice(0, 60);
  nova[COL.EQUIPE] = equipe;
  nova[COL.TENTATIVA] = tentativa;
  nova[COL.RESULTADO] = rec.resultado;
  nova[COL.ABORTO] = sn(rec.aborto);
  nova[COL.ALCANCE] = alcance;
  nova[COL.INF_EPI] = sn(inf.epi);
  nova[COL.INF_MAO] = sn(inf.mao);
  nova[COL.INF_ESPEQUE] = sn(inf.espeque);
  nova[COL.INF_GATILHO] = sn(inf.gatilho);
  nova[COL.FRASCOS] = (rec.frascos === '' || rec.frascos === null || rec.frascos === undefined) ? '' : Number(rec.frascos);
  nova[COL.MOTIVO] = rec.resultado === 'Desclassificada' ? String(rec.motivo) : '';
  nova[COL.OBS] = String(rec.obs || '').slice(0, 300);
  nova[COL.SITUACAO] = 'ATIVO';
  nova[COL.SUBSTITUI] = '';

  if (acao === 'corrigir') {
    // 4. Correção: a linha antiga vira SUBSTITUÍDO; a nova entra ATIVA.
    var alvo = acharLinha_(linhas, rec.substitui);
    if (alvo < 0) return erro_('Registro a corrigir não encontrado: ' + rec.substitui);
    var sit = linhas[alvo][COL.SITUACAO];
    nova[COL.SUBSTITUI] = rec.substitui;
    if (sit === 'SUBSTITUÍDO' || sit === 'ANULADO') {
      // alguém já corrigiu/anulou esse registro – não sobrescreve sem a CO ver
      nova[COL.SITUACAO] = 'CONFLITO';
      res.status = 'conflito';
      res.msg = 'O registro corrigido já tinha sido ' + sit.toLowerCase() + ' por outra pessoa. Gravado como CONFLITO.';
    } else {
      res.alteracoes.push({ linha: alvo, col: COL.SITUACAO, valor: 'SUBSTITUÍDO' });
      // se a correção muda equipe/tentativa, verifica se já existe outro ATIVO no destino
      var outro = acharAtivo_(linhas, equipe, tentativa, alvo);
      if (outro >= 0) {
        nova[COL.SITUACAO] = 'CONFLITO';
        res.status = 'conflito';
        res.msg = equipe + ' tentativa ' + tentativa + ' já tem outro registro ativo. Gravado como CONFLITO.';
      }
    }
    res.hist.push(hist_(ctx, 'CORREÇÃO', rec, null,
      'Substitui ' + rec.substitui + '. Antes: ' + resumo_(linhas[alvo]) + ' | Depois: ' + resumo_(nova)));
  } else {
    // 5. Registro novo: se já há um ATIVO para a mesma equipe/tentativa, vira CONFLITO.
    var existente = acharAtivo_(linhas, equipe, tentativa, -1);
    if (existente >= 0) {
      nova[COL.SITUACAO] = 'CONFLITO';
      res.status = 'conflito';
      res.msg = equipe + ' tentativa ' + tentativa + ' já estava registrada por ' +
        (linhas[existente][COL.REGISTRADO_POR] || '?') + '. Gravado como CONFLITO (não conta).';
    }
    res.hist.push(hist_(ctx, res.status === 'conflito' ? 'CONFLITO' : 'INCLUSÃO', rec, null, resumo_(nova)));
  }
  res.nova = nova;
  if (!res.msg) res.msg = 'Gravado.';
  return res;

  function erro_(m) { return { status: 'erro', msg: m, nova: null, alteracoes: [], hist: [] }; }
}

function acharLinha_(linhas, id) {
  id = String(id || '');
  if (!id) return -1;
  for (var i = 0; i < linhas.length; i++) if (String(linhas[i][COL.ID]) === id) return i;
  return -1;
}

function acharAtivo_(linhas, equipe, tentativa, ignorar) {
  for (var i = 0; i < linhas.length; i++) {
    if (i === ignorar) continue;
    var l = linhas[i];
    if (l[COL.SITUACAO] === 'ATIVO' && String(l[COL.EQUIPE]).toUpperCase() === equipe && Number(l[COL.TENTATIVA]) === tentativa) return i;
  }
  return -1;
}

function resumo_(l) {
  if (!l) return '';
  var inf = [];
  if (l[COL.INF_EPI] === 'Sim') inf.push('sem EPI');
  if (l[COL.INF_MAO] === 'Sim') inf.push('mão/pé');
  if (l[COL.INF_ESPEQUE] === 'Sim') inf.push('sem espeques');
  if (l[COL.INF_GATILHO] === 'Sim') inf.push('gatilho<2m');
  return l[COL.EQUIPE] + ' T' + l[COL.TENTATIVA] + ' ' + l[COL.RESULTADO] +
    (l[COL.ALCANCE] !== '' ? ' ' + l[COL.ALCANCE] + ' m' : '') +
    (l[COL.ABORTO] === 'Sim' ? ', aborto' : '') +
    (inf.length ? ', infrações: ' + inf.join('/') : '') +
    (l[COL.FRASCOS] !== '' && l[COL.FRASCOS] !== undefined ? ', frascos ' + l[COL.FRASCOS] : '') +
    (l[COL.MOTIVO] ? ', motivo: ' + l[COL.MOTIVO] : '');
}

function hist_(ctx, acao, rec, linhaAlvo, detalhes) {
  return [ctx.agora, acao, rec.id, String(rec.equipe || (linhaAlvo ? linhaAlvo[COL.EQUIPE] : '')).toUpperCase(),
    rec.tentativa || (linhaAlvo ? linhaAlvo[COL.TENTATIVA] : ''), rec.por || '', rec.dispositivo || '', detalhes];
}

if (typeof module !== 'undefined') module.exports = { decidirRegistro: decidirRegistro, COL: COL };
