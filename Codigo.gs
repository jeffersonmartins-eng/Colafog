/**
 * COLAFOG – back-end do app (Google Apps Script ligado à planilha).
 * Implantar como "App da Web": Executar como = Eu; Quem pode acessar = Qualquer pessoa.
 *
 * GET  ?acao=ping
 * GET  ?acao=estado&pin=...      equipes, configuração e registros (para o tablet)
 * GET  ?acao=placar              classificação das duas modalidades (telão; sem PIN)
 * POST {pin, registros:[...]}    grava a fila do tablet (idempotente pelo ID)
 */
var ABA_LAN = 'Lançamentos', ABA_EQ = 'Equipes', ABA_HIST = 'Histórico';
var COL_FORMULA_INI = 18, COL_FORMULA_FIM = 24; // R..X na aba Lançamentos

function doGet(e) {
  var p = (e && e.parameter) || {};
  try {
    if (p.acao === 'placar') return json_(placar_());
    if (p.acao === 'estado') { checarPin_(p.pin); return json_(estado_()); }
    return json_({ ok: true, servidor: new Date().toISOString(), evento: valor_('EVENTO') });
  } catch (err) { return json_({ ok: false, erro: String(err.message || err) }); }
}

function doPost(e) {
  var corpo;
  try { corpo = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, erro: 'JSON inválido' }); }
  try {
    checarPin_(corpo.pin);
  } catch (err) { return json_({ ok: false, erro: String(err.message) }); }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return json_({ ok: false, erro: 'Servidor ocupado, tente de novo.' });
  try {
    var sh = SpreadsheetApp.getActive().getSheetByName(ABA_LAN);
    var hist = SpreadsheetApp.getActive().getSheetByName(ABA_HIST);
    var ctx = { equipes: codigosEquipes_(), nLanc: Number(valor_('N_LANC')) || 2, agora: new Date() };
    var dados = lerLancamentos_(sh);   // {linhas, primeiraLinha}
    var resultados = [];
    (corpo.registros || []).forEach(function (rec) {
      var r = decidirRegistro(dados.linhas, rec, ctx);
      if (r.status === 'erro' || r.status === 'repetido') {
        if (r.status === 'erro') hist.appendRow([ctx.agora, 'ERRO', rec.id || '', rec.equipe || '', rec.tentativa || '',
          rec.por || '', rec.dispositivo || '', r.msg + ' | ' + JSON.stringify(rec)]);
        resultados.push({ id: rec.id, status: r.status, msg: r.msg });
        return;
      }
      r.alteracoes.forEach(function (a) {
        sh.getRange(a.linha + 2, a.col + 1).setValue(a.valor);
        dados.linhas[a.linha][a.col] = a.valor;
      });
      if (r.nova) {
        var linhaPlan = dados.linhas.length + 2;
        garantirFormulas_(sh, linhaPlan);
        sh.getRange(linhaPlan, 1, 1, r.nova.length).setValues([r.nova]);
        dados.linhas.push(r.nova);
      }
      r.hist.forEach(function (h) { hist.appendRow(h); });
      resultados.push({ id: rec.id, status: r.status, msg: r.msg });
    });
    SpreadsheetApp.flush();
    return json_({ ok: true, resultados: resultados });
  } catch (err) {
    return json_({ ok: false, erro: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------------------------------------------------- leitura */

function lerLancamentos_(sh) {
  var ultima = sh.getLastRow();
  // getLastRow conta as linhas com fórmula; procura a última com ID preenchido
  var ids = ultima >= 2 ? sh.getRange(2, 1, ultima - 1, 1).getValues() : [];
  var n = 0;
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim() !== '') { n = i + 1; break; }
  var linhas = n ? sh.getRange(2, 1, n, N_COLS_ENTRADA).getValues() : [];
  return { linhas: linhas };
}

function garantirFormulas_(sh, linha) {
  // as fórmulas vêm pré-preenchidas até a linha 500; além disso, copia da linha 3
  var f = sh.getRange(linha, COL_FORMULA_INI).getFormula();
  if (!f) {
    sh.getRange(3, COL_FORMULA_INI, 1, COL_FORMULA_FIM - COL_FORMULA_INI + 1)
      .copyTo(sh.getRange(linha, COL_FORMULA_INI, 1, COL_FORMULA_FIM - COL_FORMULA_INI + 1));
  }
}

function codigosEquipes_() {
  var sh = SpreadsheetApp.getActive().getSheetByName(ABA_EQ);
  var v = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 2).getValues();
  var m = {};
  v.forEach(function (l) { if (l[0] && Number(l[1]) > 0) m[String(l[0]).toUpperCase()] = true; });
  return m;
}

function estado_() {
  var ss = SpreadsheetApp.getActive();
  var eq = ss.getSheetByName(ABA_EQ);
  var ev = eq.getRange(2, 1, Math.max(1, eq.getLastRow() - 1), 5).getValues();
  var equipes = ev.filter(function (l) { return l[0] && Number(l[1]) > 0; }).map(function (l) {
    return { codigo: String(l[0]), num: Number(l[1]), modalidade: String(l[2]), nome: String(l[3]), escola: String(l[4]) };
  });
  var lan = lerLancamentos_(ss.getSheetByName(ABA_LAN)).linhas
    .filter(function (l) { return l[COL.SITUACAO] !== 'EXEMPLO'; })
    .map(function (l) {
      return {
        id: String(l[COL.ID]), registradoEm: l[COL.REGISTRADO_EM] instanceof Date ? l[COL.REGISTRADO_EM].toISOString() : String(l[COL.REGISTRADO_EM]),
        por: l[COL.REGISTRADO_POR], equipe: l[COL.EQUIPE], tentativa: Number(l[COL.TENTATIVA]), resultado: l[COL.RESULTADO],
        aborto: l[COL.ABORTO] === 'Sim', alcance: l[COL.ALCANCE],
        infracoes: { epi: l[COL.INF_EPI] === 'Sim', mao: l[COL.INF_MAO] === 'Sim', espeque: l[COL.INF_ESPEQUE] === 'Sim', gatilho: l[COL.INF_GATILHO] === 'Sim' },
        frascos: l[COL.FRASCOS], motivo: l[COL.MOTIVO], obs: l[COL.OBS], situacao: l[COL.SITUACAO], substitui: l[COL.SUBSTITUI]
      };
    });
  var motivos = ss.getRangeByName('LISTA_MOTIVO').getValues().map(function (l) { return l[0]; }).filter(String);
  return {
    ok: true,
    servidor: new Date().toISOString(),
    config: {
      evento: valor_('EVENTO'), nLanc: Number(valor_('N_LANC')), cumulativa: valor_('PEN_CUMULATIVA') === 'Sim',
      pen: { epi: valor_('PEN_EPI'), mao: valor_('PEN_MAO'), espeque: valor_('PEN_ESPEQUE'), gatilho: valor_('PEN_GATILHO') },
      frascosPadrao: Number(valor_('FRASCOS_PADRAO')), frascosMax: Number(valor_('FRASCOS_MAX')),
      vinagreMax: Number(valor_('VINAGRE_MAX_ML')), motivos: motivos
    },
    equipes: equipes,
    registros: lan
  };
}

function placar_() {
  var ss = SpreadsheetApp.getActive();
  var out = { ok: true, servidor: new Date().toISOString(), evento: valor_('EVENTO'), modalidades: {} };
  ['N3', 'N4'].forEach(function (mod) {
    var sh = ss.getSheetByName('Resultado ' + mod);
    var tab = sh.getRange('A5:P34').getValues();       // tabela por equipe
    var cls = sh.getRange('Q5:W34').getValues();       // classificação ordenada
    var classificacao = cls.filter(function (l) { return l[1] !== ''; }).map(function (l) {
      return { pos: l[0], equipe: l[1], codigo: l[2], escola: l[3], maior: l[4], soma: l[5], colocacao: String(l[6]) };
    });
    var porEquipe = tab.filter(function (l) { return l[2] !== ''; }).map(function (l) {
      return { codigo: l[1], equipe: l[2], escola: l[3], l1: l[4], l2: l[5], realizados: l[6], maior: l[7], soma: l[8],
               situacao: l[10], motivo: l[11], colocacao: l[12], empate: l[13] === 'SIM' };
    });
    out.modalidades[mod] = { classificacao: classificacao, equipes: porEquipe };
  });
  return out;
}

/* ---------------------------------------------------------------- util */

function valor_(nome) {
  var r = SpreadsheetApp.getActive().getRangeByName(nome);
  return r ? r.getValue() : '';
}

function checarPin_(pin) {
  var certo = String(valor_('APP_PIN') || '');
  if (certo && String(pin || '') !== certo) throw new Error('PIN incorreto.');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------------- configuração (rodar 1 vez) */

/**
 * Rode no editor (botão Executar) depois de importar a planilha.
 * Protege as fórmulas (só o dono edita) e confere se a estrutura está certa.
 */
function configurar() {
  var ss = SpreadsheetApp.getActive();
  var eu = Session.getEffectiveUser();
  var problemas = [];
  ['Config', ABA_EQ, ABA_LAN, 'Resultado N3', 'Resultado N4', ABA_HIST].forEach(function (n) {
    if (!ss.getSheetByName(n)) problemas.push('Falta a aba ' + n);
  });
  ['EVENTO', 'N_LANC', 'PEN_CUMULATIVA', 'PEN_EPI', 'PEN_MAO', 'PEN_ESPEQUE', 'PEN_GATILHO', 'FRASCOS_PADRAO',
   'FRASCOS_MAX', 'APP_PIN', 'LISTA_MOTIVO'].forEach(function (n) {
    if (!ss.getRangeByName(n)) problemas.push('Falta o intervalo nomeado ' + n);
  });
  if (problemas.length) throw new Error(problemas.join('\n'));

  function proteger(range, descricao) {
    var p = range.protect().setDescription(descricao);
    p.addEditor(eu);
    p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== eu.getEmail(); }));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  }
  // remove proteções antigas criadas por este script
  ss.getProtections(SpreadsheetApp.ProtectionType.RANGE).concat(ss.getProtections(SpreadsheetApp.ProtectionType.SHEET))
    .forEach(function (p) { if (/^COLAFOG/.test(p.getDescription())) p.remove(); });

  var lan = ss.getSheetByName(ABA_LAN);
  proteger(lan.getRange(1, COL_FORMULA_INI, lan.getMaxRows(), COL_FORMULA_FIM - COL_FORMULA_INI + 1), 'COLAFOG fórmulas Lançamentos');
  proteger(lan.getRange('A1:Q1'), 'COLAFOG cabeçalho Lançamentos');
  var eq = ss.getSheetByName(ABA_EQ);
  proteger(eq.getRange('A1:A' + eq.getMaxRows()), 'COLAFOG código Equipes');
  proteger(eq.getRange('L1:L' + eq.getMaxRows()), 'COLAFOG alerta Equipes');
  ['Resultado N3', 'Resultado N4'].forEach(function (n) {
    var p = ss.getSheetByName(n).protect().setDescription('COLAFOG ' + n);
    p.addEditor(eu);
    p.removeEditors(p.getEditors().filter(function (u) { return u.getEmail() !== eu.getEmail(); }));
  });
  Logger.log('Configuração concluída. Proteções aplicadas.');
  return 'ok';
}

/** Teste rápido pelo editor: lista as equipes reconhecidas e o placar atual (não grava nada). */
function testarLeitura() {
  var ctx = { equipes: codigosEquipes_(), nLanc: 2, agora: new Date() };
  Logger.log(JSON.stringify(ctx.equipes));
  Logger.log(JSON.stringify(placar_()).slice(0, 2000));
}
