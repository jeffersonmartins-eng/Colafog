/* COLAFOG – regras de cálculo usadas no modo demonstração e na prévia do tablet.
   Espelham as fórmulas das abas Lançamentos e Resultado da planilha. */
(function (global) {
  'use strict';

  function arred2(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }

  /** desconto total (0..1) de um registro */
  function desconto(inf, cfg) {
    inf = inf || {};
    var p = cfg.pen, lista = [];
    if (inf.epi) lista.push(+p.epi);
    if (inf.mao) lista.push(+p.mao);
    if (inf.espeque) lista.push(+p.espeque);
    if (inf.gatilho) lista.push(+p.gatilho);
    if (!lista.length) return 0;
    if (cfg.cumulativa) return Math.min(1, lista.reduce(function (a, b) { return a + b; }, 0));
    return Math.max.apply(null, lista);
  }

  /** alcance válido (m) ou null se não lançado */
  function alcanceValido(reg, cfg) {
    if (reg.resultado !== 'Lançado' || reg.alcance === '' || reg.alcance === null || reg.alcance === undefined) return null;
    return arred2(Math.max(0, Number(reg.alcance) * (1 - desconto(reg.infracoes, cfg))));
  }

  /**
   * Classificação de uma modalidade.
   * @return {classificacao:[...], equipes:[...]} no mesmo formato do placar do servidor
   */
  function classificar(mod, equipes, registros, cfg) {
    var ativos = registros.filter(function (r) { return r.situacao === 'ATIVO'; });
    var linhas = equipes.filter(function (e) { return e.modalidade === mod && e.num > 0; })
      .sort(function (a, b) { return a.num - b.num; })
      .map(function (e) {
        var meus = ativos.filter(function (r) { return r.equipe === e.codigo; });
        var lanc = meus.filter(function (r) { return r.resultado === 'Lançado'; });
        var vals = lanc.map(function (r) { return alcanceValido(r, cfg); }).filter(function (v) { return v !== null; });
        var dq = meus.filter(function (r) { return r.resultado === 'Desclassificada'; });
        function celula(t) {
          var rs = meus.filter(function (r) { return Number(r.tentativa) === t; });
          var l = rs.filter(function (r) { return r.resultado === 'Lançado'; });
          if (l.length) return arred2(l.reduce(function (a, r) { return a + (alcanceValido(r, cfg) || 0); }, 0));
          if (rs.some(function (r) { return r.resultado === 'Desclassificada'; })) return 'DQ';
          if (rs.some(function (r) { return r.resultado === 'Não lançado'; })) return 'NL';
          return '';
        }
        var situacao = dq.length ? 'Desclassificada' : (lanc.length ? 'Classificada' : (meus.length >= cfg.nLanc ? 'Sem alcance' : 'Aguardando'));
        var maior = lanc.length ? Math.max.apply(null, vals.length ? vals : [0]) : '';
        var soma = lanc.length ? arred2(vals.reduce(function (a, b) { return a + b; }, 0)) : '';
        return {
          codigo: e.codigo, equipe: e.nome, escola: e.escola || '', l1: celula(1), l2: celula(2),
          realizados: lanc.length, maior: maior, soma: soma, situacao: situacao,
          motivo: dq.length ? dq[0].motivo : '', colocacao: '', empate: false,
          _pont: situacao === 'Classificada' ? Math.round((maior + soma / 1e6) * 1e8) / 1e8 : null
        };
      });
    var cls = linhas.filter(function (l) { return l._pont !== null; });
    cls.forEach(function (l) {
      l.colocacao = 1 + cls.filter(function (o) { return o._pont > l._pont; }).length;
    });
    cls.forEach(function (l) {
      l.empate = cls.filter(function (o) { return o.colocacao === l.colocacao; }).length > 1;
    });
    var ordenada = cls.slice().sort(function (a, b) { return a.colocacao - b.colocacao || linhas.indexOf(a) - linhas.indexOf(b); });
    return {
      classificacao: ordenada.map(function (l, i) {
        return { pos: i + 1, equipe: l.equipe, codigo: l.codigo, escola: l.escola, maior: l.maior, soma: l.soma,
                 colocacao: String(l.colocacao) + (l.empate ? ' (empate)' : '') };
      }),
      equipes: linhas.map(function (l) { delete l._pont; return l; })
    };
  }

  var api = { desconto: desconto, alcanceValido: alcanceValido, classificar: classificar, arred2: arred2 };
  if (typeof module !== 'undefined') module.exports = api; else global.Regras = api;
})(this);
