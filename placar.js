/* COLAFOG – placar para o telão. Lê a aba de resultado da planilha (via Apps Script) a cada 15 s. */
(function () {
  'use strict';
  var NOMES = { N3: 'Nível 3 – água e ar comprimido', N4: 'Nível 4 – vinagre e bicarbonato' };
  var qs = new URLSearchParams(location.search);
  var ajustes = {};
  try { ajustes = JSON.parse(localStorage.getItem('colafog.ajustes') || '{}') || {}; } catch (e) {}
  var url = qs.get('srv') || ajustes.url || '';
  var modo = qs.get('mod') || 'ambas';
  var ultimo = null;
  try { ultimo = JSON.parse(localStorage.getItem('colafog.placar') || 'null'); } catch (e) {}

  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n === '' || n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  function placarDemo() {
    var d = JSON.parse(localStorage.getItem('colafog.demo') || '{"equipes":[],"linhas":[]}');
    var C = COL, cfg = { nLanc: 2, cumulativa: true, pen: { epi: .2, mao: .2, espeque: .2, gatilho: .2 } };
    var regs = d.linhas.map(function (l) {
      return { equipe: l[C.EQUIPE], tentativa: l[C.TENTATIVA], resultado: l[C.RESULTADO], alcance: l[C.ALCANCE], situacao: l[C.SITUACAO], motivo: l[C.MOTIVO],
        infracoes: { epi: l[C.INF_EPI] === 'Sim', mao: l[C.INF_MAO] === 'Sim', espeque: l[C.INF_ESPEQUE] === 'Sim', gatilho: l[C.INF_GATILHO] === 'Sim' } };
    });
    return Promise.resolve({ ok: true, evento: '6ª COLAFOG (DEMONSTRAÇÃO)', servidor: new Date().toISOString(),
      modalidades: { N3: Regras.classificar('N3', d.equipes, regs, cfg), N4: Regras.classificar('N4', d.equipes, regs, cfg) } });
  }
  function buscar() {
    if (url === 'demo') return placarDemo();
    if (!url) return Promise.reject(new Error('Abra o app neste aparelho e configure o servidor, ou use placar.html?srv=URL_DO_APP_DA_WEB'));
    return fetch(url + '?acao=placar&t=' + Date.now()).then(function (r) { return r.json(); });
  }

  function secao(mod, dados) {
    var cls = dados.classificacao || [], eqs = dados.equipes || [];
    var p = [1, 2, 3].map(function (i) {
      var c = cls[i - 1];
      return '<div class="lugar p' + i + '"><div class="n">' + i + 'º</div>' + (c ?
        '<div class="eq">' + esc(c.equipe) + '</div><div class="esc">' + esc(c.escola) + '</div><div class="alc">' + fmt(c.maior) + ' m</div>' +
        (/empate/.test(c.colocacao) ? '<div class="empate">empate total – CO decide</div>' : '') : '<div class="esc">—</div>') + '</div>';
    }).join('');
    var linhas = cls.map(function (c) {
      return '<tr class="' + (c.pos <= 3 ? 'top' : '') + '"><td class="pos">' + esc(String(c.colocacao).replace(' (empate)', '')) + 'º' +
        (/empate/.test(c.colocacao) ? ' <span class="empate">=</span>' : '') + '</td><td>' + esc(c.equipe) + '</td><td class="num">' + fmt(c.maior) + '</td><td class="num">' + fmt(c.soma) + '</td></tr>';
    }).join('');
    var outros = eqs.filter(function (e) { return e.situacao !== 'Classificada'; }).map(function (e) {
      var dq = e.situacao === 'Desclassificada';
      return '<tr class="' + (dq ? 'dq' : 'cinza') + '"><td class="pos">' + (dq ? 'DQ' : '–') + '</td><td>' + esc(e.equipe) + '</td><td colspan="2" class="num">' +
        esc(dq ? (e.motivo || 'Desclassificada') : e.situacao) + '</td></tr>';
    }).join('');
    var n = eqs.length, feitos = eqs.filter(function (e) { return e.situacao !== 'Aguardando'; }).length;
    return '<section><h2>' + esc(NOMES[mod]) + '</h2><div class="sub">' + cls.length + ' classificada(s) · ' + feitos + ' de ' + n + ' equipes com resultado · ' +
      'desempate pela soma dos alcances (Art. 22)</div><div class="podio">' + p + '</div>' +
      (linhas || outros ? '<table><thead><tr><th>Pos.</th><th>Equipe</th><th class="num">Maior alcance (m)</th><th class="num">Soma (m)</th></tr></thead><tbody>' + linhas + outros + '</tbody></table>'
        : '<div class="vazio">Aguardando lançamentos…</div>') + '</section>';
  }

  function desenhar(d) {
    if (!d) return;
    document.getElementById('titulo').textContent = (d.evento || 'COLAFOG') + ' – Placar';
    var mods = modo === 'ambas' ? ['N3', 'N4'] : [modo];
    var m = document.getElementById('main');
    m.className = mods.length === 1 ? 'uma' : '';
    m.innerHTML = mods.map(function (k) { return secao(k, (d.modalidades || {})[k] || {}); }).join('');
  }

  function atualizar() {
    var est = document.getElementById('estado');
    buscar().then(function (d) {
      if (!d.ok) throw new Error(d.erro || 'Erro');
      ultimo = d;
      try { localStorage.setItem('colafog.placar', JSON.stringify(d)); } catch (e) {}
      desenhar(d);
      est.className = 'estado'; est.textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR');
    }).catch(function (e) {
      desenhar(ultimo);
      est.className = 'estado off'; est.textContent = 'Sem conexão – mostrando último placar. ' + e.message;
    });
  }

  function exportar() {
    if (!ultimo) return;
    var L = [['Modalidade', 'Colocação', 'Código', 'Equipe', 'Escola', 'L1 válido (m)', 'L2 válido (m)', 'Lançamentos realizados', 'Maior alcance (m)', 'Soma (m)', 'Situação', 'Motivo', 'Empate total']];
    ['N3', 'N4'].forEach(function (mod) {
      var eqs = ((ultimo.modalidades || {})[mod] || {}).equipes || [];
      eqs.slice().sort(function (a, b) { return (a.colocacao || 999) - (b.colocacao || 999); }).forEach(function (e) {
        var n = function (v) { return typeof v === 'number' ? String(v).replace('.', ',') : (v || ''); };
        L.push([mod, e.colocacao || '', e.codigo, e.equipe, e.escola, n(e.l1), n(e.l2), e.realizados, n(e.maior), n(e.soma), e.situacao, e.motivo || '', e.empate ? 'SIM' : '']);
      });
    });
    var txt = '﻿' + L.map(function (l) { return l.map(function (v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    a.download = 'colafog-resultado-final.csv'; document.body.appendChild(a); a.click(); a.remove();
  }

  document.querySelectorAll('[data-mod]').forEach(function (b) {
    if (b.dataset.mod === modo) { document.querySelector('[data-mod].sel').classList.remove('sel'); b.classList.add('sel'); }
    b.onclick = function () { modo = b.dataset.mod; document.querySelectorAll('[data-mod]').forEach(function (x) { x.classList.toggle('sel', x === b); }); desenhar(ultimo); };
  });
  document.getElementById('btnCsv').onclick = exportar;
  document.getElementById('btnImp').onclick = function () { window.print(); };
  document.getElementById('btnTela').onclick = function () { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(function () {}); };
  setInterval(function () { document.getElementById('hora').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }, 1000);
  desenhar(ultimo); atualizar();
  setInterval(atualizar, 15000);
})();
