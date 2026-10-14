/* COLAFOG – app de registro para tablet (PWA, funciona offline com fila local) */
(function () {
  'use strict';

  // ------------------------------------------------------------------ armazenamento
  var K = { ajustes: 'colafog.ajustes', cache: 'colafog.cache', fila: 'colafog.fila', demo: 'colafog.demo' };
  function ler(k, padrao) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } }
  function gravar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { aviso('Sem espaço para salvar no tablet!', 'erro'); } }

  var ajustes = ler(K.ajustes, null);
  var cache = ler(K.cache, { config: null, equipes: [], registros: [], atualizado: null });
  var fila = ler(K.fila, []);
  var status = { online: null, sincronizando: false, ultimaSinc: cache.atualizado, erro: '' };

  var CONFIG_PADRAO = {
    evento: '6ª COLAFOG – VIII SpaceIF', nLanc: 2, cumulativa: true,
    pen: { epi: 0.2, mao: 0.2, espeque: 0.2, gatilho: 0.2 }, frascosPadrao: 1, frascosMax: 2, vinagreMax: 500,
    motivos: ['Sem itens de segurança no tempo da etapa (Art. 21 I)', 'Mistura fora do foguete – Nível 4 (Art. 19 III)',
      'Vinagre acima de 500 mL – Nível 4 (Art. 19 III)', 'Reagente químico ou compressor elétrico – Nível 3 (Art. 19 III)',
      'Parte metálica no bico ou aletas (Art. 19 I)', 'Indisciplina (Art. 28)', 'Outro – descrever na observação (Art. 29)']
  };
  var INFRACOES = [
    { k: 'epi', nome: 'Sem óculos ou calçado fechado' },
    { k: 'mao', nome: 'Base segurada com mão ou pé' },
    { k: 'espeque', nome: 'Base sem espeques / apoiada em pedras ou tijolos' },
    { k: 'gatilho', nome: 'Gatilho acionado a menos de 2 m' }
  ];
  var MODS = {
    N3: { nome: 'Nível 3', desc: 'Água e ar comprimido', hora: '10h' },
    N4: { nome: 'Nível 4', desc: 'Vinagre e bicarbonato', hora: '16h' }
  };
  function cfg() { return cache.config || CONFIG_PADRAO; }

  // ------------------------------------------------------------------ util
  var $ = function (s, el) { return (el || document).querySelector(s); };
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) { return (n === '' || n === null || n === undefined || isNaN(n)) ? '—' : Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(x) { return Math.round(Number(x) * 100) + '%'; }
  function hora(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? String(iso) : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function novoId() {
    var disp = (ajustes && ajustes.dispositivo || 'tab').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'tab';
    return disp + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }
  var timerAviso;
  function aviso(msg, tipo) {
    var el = $('#aviso'); el.textContent = msg; el.className = 'aviso ' + (tipo || ''); el.hidden = false;
    clearTimeout(timerAviso); timerAviso = setTimeout(function () { el.hidden = true; }, tipo === 'erro' || tipo === 'alerta' ? 6000 : 2800);
  }
  function equipe(cod) { return cache.equipes.filter(function (e) { return e.codigo === cod; })[0]; }

  // ------------------------------------------------------------------ servidor (Apps Script ou demonstração)
  function comTempo(p, ms) {
    return Promise.race([p, new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Tempo esgotado')); }, ms); })]);
  }
  var servidorReal = {
    estado: function () {
      return comTempo(fetch(ajustes.url + '?acao=estado&pin=' + encodeURIComponent(ajustes.pin || '') + '&t=' + Date.now()), 25000)
        .then(function (r) { return r.json(); });
    },
    enviar: function (regs) {
      return comTempo(fetch(ajustes.url, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ pin: ajustes.pin || '', registros: regs })
      }), 30000).then(function (r) { return r.json(); });
    }
  };
  var servidorDemo = (function () {
    function base() {
      var d = ler(K.demo, null);
      if (d) return d;
      var eq = [];
      ['Órbita Baixa', 'Apolo Mirim', 'Cometas', 'Via Láctea', 'Gagarin', 'Estrela Guia', 'Hubble Kids', 'Plutão Vive']
        .forEach(function (n, i) { eq.push({ codigo: 'N3-0' + (i + 1), num: i + 1, modalidade: 'N3', nome: n, escola: 'Escola Demo ' + (1 + i % 3) }); });
      ['Bicarbonautas', 'Vinagre Veloz', 'Supernova', 'Kepler', 'Andrômeda', 'Pulsar']
        .forEach(function (n, i) { eq.push({ codigo: 'N4-0' + (i + 1), num: i + 1, modalidade: 'N4', nome: n, escola: 'Escola Demo ' + (1 + i % 3) }); });
      d = { equipes: eq, linhas: [] };
      gravar(K.demo, d);
      return d;
    }
    function paraObj(l) {
      var C = COL;
      return { id: l[C.ID], registradoEm: l[C.REGISTRADO_EM], por: l[C.REGISTRADO_POR], equipe: l[C.EQUIPE], tentativa: l[C.TENTATIVA],
        resultado: l[C.RESULTADO], aborto: l[C.ABORTO] === 'Sim', alcance: l[C.ALCANCE],
        infracoes: { epi: l[C.INF_EPI] === 'Sim', mao: l[C.INF_MAO] === 'Sim', espeque: l[C.INF_ESPEQUE] === 'Sim', gatilho: l[C.INF_GATILHO] === 'Sim' },
        frascos: l[C.FRASCOS], motivo: l[C.MOTIVO], obs: l[C.OBS], situacao: l[C.SITUACAO], substitui: l[C.SUBSTITUI] };
    }
    return {
      estado: function () {
        var d = base();
        return Promise.resolve({ ok: true, config: CONFIG_PADRAO, equipes: d.equipes, registros: d.linhas.map(paraObj), servidor: new Date().toISOString() });
      },
      enviar: function (regs) {
        var d = base(), ctx = { equipes: {}, nLanc: CONFIG_PADRAO.nLanc, agora: new Date().toISOString() };
        d.equipes.forEach(function (e) { ctx.equipes[e.codigo] = true; });
        var res = regs.map(function (rec) {
          var r = decidirRegistro(d.linhas, rec, ctx);
          r.alteracoes.forEach(function (a) { d.linhas[a.linha][a.col] = a.valor; });
          if (r.nova) { r.nova[COL.REGISTRADO_EM] = rec.registradoEm; d.linhas.push(r.nova); }
          return { id: rec.id, status: r.status, msg: r.msg };
        });
        gravar(K.demo, d);
        return Promise.resolve({ ok: true, resultados: res });
      },
      placar: function () {
        var d = base(), regs = d.linhas.map(paraObj);
        return { ok: true, servidor: new Date().toISOString(), evento: CONFIG_PADRAO.evento + ' (DEMONSTRAÇÃO)',
          modalidades: { N3: Regras.classificar('N3', d.equipes, regs, CONFIG_PADRAO), N4: Regras.classificar('N4', d.equipes, regs, CONFIG_PADRAO) } };
      }
    };
  })();
  window.ColafogDemo = servidorDemo; // usado pelo placar no modo demonstração
  function servidor() { return ajustes && ajustes.url === 'demo' ? servidorDemo : servidorReal; }

  // ------------------------------------------------------------------ visão local (servidor + fila)
  function visao() {
    var regs = cache.registros.map(function (r) { return Object.assign({}, r); });
    function porId(id) { return regs.filter(function (r) { return r.id === id; })[0]; }
    fila.forEach(function (f) {
      if (f._estado === 'erro') return;
      if (porId(f.id)) return;
      if (f.acao === 'anular') { var a = porId(f.substitui); if (a) a.situacao = 'ANULADO'; return; }
      var n = Object.assign({}, f, { situacao: 'ATIVO', _pend: true });
      if (f.acao === 'corrigir') {
        var alvo = porId(f.substitui); if (alvo) alvo.situacao = 'SUBSTITUÍDO';
      } else if (regs.some(function (r) { return r.situacao === 'ATIVO' && r.equipe === f.equipe && Number(r.tentativa) === Number(f.tentativa); })) {
        n.situacao = 'CONFLITO';
      }
      regs.push(n);
    });
    return regs;
  }
  function ativo(regs, cod, t) {
    return regs.filter(function (r) { return r.situacao === 'ATIVO' && r.equipe === cod && Number(r.tentativa) === t; })[0];
  }
  function temConflito(regs, cod, t) {
    return regs.some(function (r) { return r.situacao === 'CONFLITO' && r.equipe === cod && (t === undefined || Number(r.tentativa) === t); });
  }
  function textoResultado(r) {
    if (!r) return '';
    if (r.resultado === 'Lançado') {
      var v = Regras.alcanceValido(r, cfg());
      return fmt(r.alcance) + ' m' + (v !== null && v !== Number(r.alcance) ? ' → válido ' + fmt(v) + ' m' : '');
    }
    if (r.resultado === 'Desclassificada') return 'DESCLASSIFICADA';
    return 'Não lançado';
  }

  // ------------------------------------------------------------------ sincronização
  function atualizarPilula() {
    var pend = fila.filter(function (f) { return f._estado !== 'erro'; }).length;
    var errs = fila.length - pend;
    var p = $('#sincPonto'), t = $('#sincTexto');
    p.className = 'sinc-ponto ' + (status.online === false ? 'off' : pend ? 'pend' : status.online ? 'on' : '');
    var txt = status.sincronizando ? 'Enviando…' : status.online === false ? 'Sem conexão' : 'Online';
    if (pend) txt += ' · ' + pend + ' na fila';
    if (errs) txt += ' · ' + errs + ' com erro';
    if (ajustes && ajustes.url === 'demo') txt = 'DEMO' + (pend ? ' · ' + pend : '');
    t.textContent = txt;
  }
  function sincronizar(silencioso) {
    if (!ajustes || status.sincronizando) return Promise.resolve();
    status.sincronizando = true; atualizarPilula();
    var pend = fila.filter(function (f) { return f._estado !== 'erro'; }).slice(0, 25);
    var p = pend.length ? servidor().enviar(pend.map(limpar)) : Promise.resolve(null);
    return p.then(function (resp) {
      if (resp) {
        if (!resp.ok) throw new Error(resp.erro || 'Erro no servidor');
        var porId = {};
        resp.resultados.forEach(function (r) { porId[r.id] = r; });
        fila = fila.filter(function (f) {
          var r = porId[f.id];
          if (!r) return true;
          if (r.status === 'erro') { f._estado = 'erro'; f._msg = r.msg; return true; }
          if (r.status === 'conflito') aviso('CONFLITO: ' + r.msg, 'alerta');
          return false;
        });
        gravar(K.fila, fila);
      }
      return servidor().estado();
    }).then(function (est) {
      if (!est.ok) throw new Error(est.erro || 'Erro no servidor');
      cache = { config: est.config, equipes: est.equipes, registros: est.registros, atualizado: new Date().toISOString() };
      gravar(K.cache, cache);
      status.online = true; status.erro = ''; status.ultimaSinc = cache.atualizado;
    }).catch(function (e) {
      status.online = false; status.erro = e.message;
      if (/PIN/.test(e.message)) aviso('PIN incorreto – confira em Ajustes.', 'erro');
      else if (!silencioso) aviso('Sem conexão: dados ficam guardados no tablet.', 'alerta');
    }).then(function () {
      status.sincronizando = false; atualizarPilula();
      if (['modalidade', 'equipes', 'tentativa', 'registros'].indexOf(atual.tela) >= 0) render();
      // ainda há pendentes? continua enviando
      if (status.online && fila.some(function (f) { return f._estado !== 'erro'; })) setTimeout(function () { sincronizar(true); }, 1500);
    });
  }
  function limpar(f) { var o = {}; Object.keys(f).forEach(function (k) { if (k[0] !== '_') o[k] = f[k]; }); return o; }
  function enfileirar(rec) {
    rec.id = novoId(); rec.por = ajustes.nome; rec.dispositivo = ajustes.dispositivo; rec.registradoEm = new Date().toISOString();
    rec._estado = 'pendente';
    fila.push(rec); gravar(K.fila, fila); atualizarPilula();
    sincronizar(true);
    return rec;
  }

  // ------------------------------------------------------------------ navegação
  var pilha = [];
  var atual = { tela: null, p: {} };
  function ir(tela, p, substituir) {
    if (atual.tela && !substituir) pilha.push(atual);
    atual = { tela: tela, p: p || {} };
    $('#menu').hidden = true;
    render(); window.scrollTo(0, 0);
  }
  function voltar() { if (pilha.length) { atual = pilha.pop(); render(); window.scrollTo(0, 0); } }
  function inicio(tela, p) { pilha = []; atual = { tela: null }; ir(tela, p); }

  function cabecalho(t, s) {
    $('#tituloTela').textContent = t; $('#subtituloTela').textContent = s || (ajustes ? ajustes.nome + ' · ' + ajustes.dispositivo : '');
    $('#btnVoltar').hidden = !pilha.length;
  }
  function render() {
    var f = TELAS[atual.tela] || TELAS.modalidade;
    var el = $('#tela'); el.innerHTML = '';
    f(el, atual.p);
  }
  function h(html) { var d = document.createElement('div'); d.innerHTML = html; return d; }

  // ------------------------------------------------------------------ telas
  var TELAS = {};

  TELAS.ajustes = function (el) {
    cabecalho('Ajustes do tablet', 'Preencha uma vez em cada tablet');
    var a = ajustes || { url: '', pin: '', nome: '', dispositivo: '' };
    el.appendChild(h(
      '<div class="secao"><h3>Quem está registrando</h3>' +
      '<label class="rotulo" for="aNome">Seu nome</label><input class="campo" id="aNome" value="' + esc(a.nome) + '" placeholder="Ex.: Ana (bolsista)">' +
      '<label class="rotulo" for="aDisp">Nome do tablet</label><input class="campo" id="aDisp" value="' + esc(a.dispositivo) + '" placeholder="Ex.: tablet-1"></div>' +
      '<div class="secao"><h3>Servidor (planilha Google)</h3>' +
      '<label class="rotulo" for="aUrl">Endereço do App da Web (termina em /exec) – ou escreva <b>demo</b></label>' +
      '<input class="campo" id="aUrl" value="' + esc(a.url) + '" placeholder="https://script.google.com/macros/s/.../exec" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '<label class="rotulo" for="aPin">PIN</label><input class="campo" id="aPin" value="' + esc(a.pin) + '" autocapitalize="off">' +
      '<p class="dica">No modo <b>demo</b> nada vai para a planilha: serve para treinar os bolsistas.</p></div>' +
      '<div class="grade-2"><button class="botao primario" id="aSalvar">Salvar e testar conexão</button>' +
      '<button class="botao" id="aDemo">Usar modo demonstração</button></div>' +
      '<div class="secao"><h3>Dados deste tablet</h3><p class="dica">Na fila: ' + fila.length + ' registro(s). Última sincronização: ' +
      (status.ultimaSinc ? new Date(status.ultimaSinc).toLocaleString('pt-BR') : 'nunca') + (status.erro ? '<br>Último erro: ' + esc(status.erro) : '') + '</p>' +
      '<div class="grade-2"><button class="botao" id="aCsv">Exportar registros deste tablet (CSV)</button>' +
      '<button class="botao perigo" id="aLimparDemo">Apagar dados da demonstração</button></div></div>'));
    function salvar(url) {
      var n = { nome: $('#aNome').value.trim(), dispositivo: $('#aDisp').value.trim(), url: (url || $('#aUrl').value).trim(), pin: $('#aPin').value.trim() };
      if (!n.nome || !n.dispositivo) { aviso('Preencha seu nome e o nome do tablet.', 'erro'); return; }
      if (n.url !== 'demo' && !/^https:\/\/script\.google(usercontent)?\.com\//.test(n.url)) { aviso('Endereço inválido. Copie o link do App da Web (…/exec) ou use demo.', 'erro'); return; }
      var trocouServidor = !ajustes || ajustes.url !== n.url;
      ajustes = n; gravar(K.ajustes, ajustes);
      if (trocouServidor) { cache = { config: null, equipes: [], registros: [], atualizado: null }; gravar(K.cache, cache); }
      sincronizar().then(function () {
        if (status.online) { aviso('Conectado! ' + cache.equipes.length + ' equipes carregadas.', 'ok'); inicio('modalidade'); }
      });
    }
    $('#aSalvar').onclick = function () { salvar(); };
    $('#aDemo').onclick = function () { $('#aUrl').value = 'demo'; salvar('demo'); };
    $('#aCsv').onclick = exportarCsv;
    $('#aLimparDemo').onclick = function () {
      if (confirm('Apagar os lançamentos da demonstração?')) { localStorage.removeItem(K.demo); if (ajustes && ajustes.url === 'demo') { fila = []; gravar(K.fila, fila); sincronizar(); } aviso('Demonstração zerada.', 'ok'); }
    };
  };

  TELAS.modalidade = function (el) {
    cabecalho(cfg().evento || 'COLAFOG');
    var regs = visao();
    var htmlB = Object.keys(MODS).map(function (m) {
      var eqs = cache.equipes.filter(function (e) { return e.modalidade === m; });
      var feitos = regs.filter(function (r) { return r.situacao === 'ATIVO' && eqs.some(function (e) { return e.codigo === r.equipe; }); }).length;
      return '<button class="botao grande" data-m="' + m + '">' + MODS[m].nome + '<small>' + MODS[m].desc + ' · ' + MODS[m].hora + '</small>' +
        '<small>' + eqs.length + ' equipes · ' + feitos + ' de ' + eqs.length * cfg().nLanc + ' tentativas registradas</small></button>';
    }).join('');
    el.appendChild(h('<h2>Escolha a modalidade</h2><div class="grade-2">' + htmlB + '</div>' +
      (cache.equipes.length ? '' : '<div class="alerta amarelo">Nenhuma equipe carregada ainda. Conecte-se à internet e toque no botão de sincronização (canto superior).</div>')));
    el.querySelectorAll('[data-m]').forEach(function (b) { b.onclick = function () { ir('equipes', { mod: b.dataset.m }); }; });
  };

  TELAS.equipes = function (el, p) {
    cabecalho(MODS[p.mod].nome + ' – escolha a equipe');
    var regs = visao();
    el.appendChild(h('<input class="busca" id="busca" type="search" placeholder="Buscar por nome ou número…" value="' + esc(p.busca || '') + '"><div class="grade" id="gradeEq"></div>'));
    function desenhar() {
      var q = ($('#busca').value || '').toLowerCase();
      p.busca = q;
      var eqs = cache.equipes.filter(function (e) { return e.modalidade === p.mod && (!q || (e.nome + ' ' + e.num + ' ' + e.codigo).toLowerCase().indexOf(q) >= 0); })
        .sort(function (a, b) { return a.num - b.num; });
      $('#gradeEq').innerHTML = eqs.map(function (e) {
        var chips = '', completo = true;
        for (var t = 1; t <= cfg().nLanc; t++) {
          var r = ativo(regs, e.codigo, t);
          var c = 'chip', txt = 'L' + t + ' —';
          if (r) {
            if (r.resultado === 'Lançado') { c += ' ok'; txt = 'L' + t + ' ' + fmt(Regras.alcanceValido(r, cfg())); }
            else if (r.resultado === 'Desclassificada') { c += ' dq'; txt = 'L' + t + ' DQ'; }
            else txt = 'L' + t + ' NL';
            if (r._pend) { c += ' pend'; txt += ' ⏳'; }
          } else completo = false;
          if (temConflito(regs, e.codigo, t)) { c = 'chip conf'; txt = 'L' + t + ' CONFLITO'; }
          chips += '<span class="' + c + '">' + txt + '</span>';
        }
        return '<button class="botao' + (completo ? ' feito' : '') + '" data-c="' + esc(e.codigo) + '"><span class="equipe-num">' + esc(e.codigo) + '</span>' +
          esc(e.nome) + '<small>' + esc(e.escola) + '</small><span class="chips">' + chips + '</span></button>';
      }).join('') || '<p class="dica">Nenhuma equipe encontrada.</p>';
      $('#gradeEq').querySelectorAll('[data-c]').forEach(function (b) { b.onclick = function () { ir('tentativa', { mod: p.mod, equipe: b.dataset.c }); }; });
    }
    $('#busca').oninput = desenhar;
    desenhar();
  };

  TELAS.tentativa = function (el, p) {
    var e = equipe(p.equipe) || { nome: p.equipe, codigo: p.equipe };
    cabecalho(e.codigo + ' · ' + e.nome, MODS[p.mod].nome + ' – escolha a tentativa');
    var regs = visao(), html = '';
    for (var t = 1; t <= cfg().nLanc; t++) {
      var r = ativo(regs, e.codigo, t);
      if (r) {
        html += '<button class="botao grande feito" data-t="' + t + '" data-id="' + esc(r.id) + '">' + t + 'º lançamento<small>Registrado: ' + esc(textoResultado(r)) +
          '</small><small>por ' + esc(r.por) + ' às ' + hora(r.registradoEm) + (r._pend ? ' (na fila)' : '') + ' · tocar para CORRIGIR</small></button>';
      } else {
        html += '<button class="botao grande primario" data-t="' + t + '">' + t + 'º lançamento<small>Ainda não registrado</small></button>';
      }
    }
    el.appendChild(h('<div class="grade-2">' + html + '</div>' +
      (temConflito(regs, e.codigo) ? '<div class="alerta amarelo">Esta equipe tem registro em CONFLITO. Resolva em Registros e correções.</div>' : '')));
    el.querySelectorAll('[data-t]').forEach(function (b) {
      b.onclick = function () {
        var base = b.dataset.id ? regs.filter(function (x) { return x.id === b.dataset.id; })[0] : null;
        ir('formulario', { mod: p.mod, equipe: e.codigo, tentativa: Number(b.dataset.t), base: base ? limpar(base) : null });
      };
    });
  };

  TELAS.formulario = function (el, p) {
    var e = equipe(p.equipe) || { nome: p.equipe, codigo: p.equipe };
    var c = cfg();
    var corr = !!p.base;
    // estado do formulário (persistente ao voltar da confirmação)
    var f = p.f || (p.f = corr ? {
      resultado: p.base.resultado, alcance: p.base.alcance === '' || p.base.alcance === null ? '' : String(p.base.alcance).replace('.', ','),
      aborto: !!p.base.aborto, infracoes: Object.assign({}, p.base.infracoes), frascos: p.base.frascos === '' ? (p.mod === 'N4' ? c.frascosPadrao : '') : p.base.frascos,
      motivo: p.base.motivo || '', obs: '', motivoCorrecao: ''
    } : { resultado: 'Lançado', alcance: '', aborto: false, infracoes: {}, frascos: p.mod === 'N4' ? c.frascosPadrao : '', motivo: '', obs: '', motivoCorrecao: '' });

    cabecalho((corr ? 'CORRIGIR · ' : '') + e.codigo + ' · ' + p.tentativa + 'º lançamento', e.nome);
    var seg = function (nome, opcoes, val) {
      return '<div class="seg">' + opcoes.map(function (o) {
        return '<button class="botao' + (String(val) === String(o[0]) ? ' sel' : '') + '" data-' + nome + '="' + esc(o[0]) + '">' + o[1] + '</button>';
      }).join('') + '</div>';
    };
    var html = '';
    if (corr) html += '<div class="alerta amarelo">Você está corrigindo um registro. O original fica guardado no histórico.</div>';
    html += '<div class="secao"><h3>Resultado da tentativa</h3>' +
      seg('res', [['Lançado', 'Lançado'], ['Não lançado', 'Não lançado<small>abortou e não relançou / tempo esgotado</small>'], ['Desclassificada', 'Desclassificada']], f.resultado) + '</div>';
    html += '<div class="layout-form"><div>';
    if (f.resultado === 'Lançado') {
      html += '<div class="secao"><h3>Alcance horizontal medido (m)</h3>' +
        '<div class="visor" id="visor">' + (esc(f.alcance) || '0') + '<small>m</small></div>' +
        '<div class="teclado">' + ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', '⌫'].map(function (k) { return '<button data-k="' + k + '">' + k + '</button>'; }).join('') + '</div>' +
        '<p class="dica">Medida perpendicular ao espaço de lançamento, até o meio do corpo do foguete.</p></div>';
    } else if (f.resultado === 'Desclassificada') {
      html += '<div class="secao"><h3>Motivo da desclassificação</h3><div class="lista-reg">' + c.motivos.map(function (m) {
        return '<button class="botao' + (f.motivo === m ? ' sel' : '') + '" data-motivo="' + esc(m) + '">' + esc(m) + '</button>';
      }).join('') + '</div><p class="dica">A equipe sai da classificação desta modalidade.</p></div>';
    } else {
      html += '<div class="secao"><h3>Não lançado</h3><p class="dica">Não conta como lançamento realizado. Se o foguete caiu durante o aborto, o regulamento conta como lançamento: volte e marque <b>Lançado</b> com o alcance medido.</p></div>';
    }
    html += '</div><div>';
    html += '<div class="secao"><h3>Houve despressurização (aborto) nesta tentativa?</h3>' + seg('ab', [['nao', 'Não'], ['sim', 'Sim']], f.aborto ? 'sim' : 'nao') + '</div>';
    if (f.resultado === 'Lançado') {
      html += '<div class="secao"><h3>Infrações (desconto no alcance)</h3><div class="lista-reg">' + INFRACOES.map(function (i) {
        return '<button class="botao' + (f.infracoes[i.k] ? ' sel' : '') + '" data-inf="' + i.k + '">' + (f.infracoes[i.k] ? '☑ ' : '☐ ') + i.nome + '<small>−' + pct(c.pen[i.k]) + '</small></button>';
      }).join('') + '</div></div>';
    }
    if (p.mod === 'N4') {
      html += '<div class="secao"><h3>Frascos de vinagre (500 mL) usados</h3>' + seg('fr', [['1', '1 frasco'], ['2', '2 frascos']], f.frascos) +
        '<p class="dica">O 2º frasco só é entregue se houve despressurização.</p></div>';
    }
    html += '<div class="secao"><h3>Observação (opcional)</h3><textarea id="obs" placeholder="Ex.: vento forte, foguete caiu fora da área…">' + esc(f.obs) + '</textarea>' +
      (corr ? '<label class="rotulo" for="motCorr">Motivo da correção (obrigatório)</label><textarea id="motCorr" placeholder="Ex.: alcance digitado errado (era 58,4)">' + esc(f.motivoCorrecao) + '</textarea>' : '') + '</div>';
    html += '</div></div><div id="previa"></div><div style="height:90px"></div>';
    html += '<div class="barra-acoes"><button class="botao" id="fCancelar">Cancelar</button><button class="botao primario" id="fRevisar">Revisar ›</button></div>';
    el.appendChild(h(html));

    function previa() {
      var box = $('#previa'); if (!box) return;
      var msgs = [];
      if (f.resultado === 'Lançado') {
        var v = Regras.alcanceValido({ resultado: 'Lançado', alcance: Number(String(f.alcance).replace(',', '.')) || 0, infracoes: f.infracoes }, c);
        var d = Regras.desconto(f.infracoes, c);
        msgs.push('<div class="previa">Alcance válido: <b>' + fmt(v) + ' m</b>' + (d ? ' (desconto de ' + pct(d) + ')' : '') + '</div>');
      }
      if (p.mod === 'N4' && Number(f.frascos) > c.frascosPadrao && !f.aborto) msgs.push('<div class="alerta amarelo">2º frasco sem despressurização: confira.</div>');
      box.innerHTML = msgs.join('');
    }
    previa();
    var visor = $('#visor');
    el.querySelectorAll('[data-k]').forEach(function (b) {
      b.onclick = function () {
        var k = b.dataset.k, s = String(f.alcance);
        if (k === '⌫') s = s.slice(0, -1);
        else if (k === ',') { if (s.indexOf(',') < 0) s = (s || '0') + ','; }
        else {
          if (s.indexOf(',') >= 0 && s.split(',')[1].length >= 2) return;
          if (s.replace(',', '').length >= 6) return;
          s = (s === '0' ? '' : s) + k;
        }
        f.alcance = s; visor.innerHTML = (esc(s) || '0') + '<small>m</small>'; previa();
      };
    });
    function rerender() { f.obs = $('#obs').value; if ($('#motCorr')) f.motivoCorrecao = $('#motCorr').value; var y = window.scrollY; render(); window.scrollTo(0, y); }
    el.querySelectorAll('[data-res]').forEach(function (b) { b.onclick = function () { f.resultado = b.dataset.res; rerender(); }; });
    el.querySelectorAll('[data-ab]').forEach(function (b) { b.onclick = function () { f.aborto = b.dataset.ab === 'sim'; rerender(); }; });
    el.querySelectorAll('[data-inf]').forEach(function (b) { b.onclick = function () { f.infracoes[b.dataset.inf] = !f.infracoes[b.dataset.inf]; rerender(); }; });
    el.querySelectorAll('[data-fr]').forEach(function (b) { b.onclick = function () { f.frascos = Number(b.dataset.fr); rerender(); }; });
    el.querySelectorAll('[data-motivo]').forEach(function (b) { b.onclick = function () { f.motivo = b.dataset.motivo; rerender(); }; });
    $('#fCancelar').onclick = voltar;
    $('#fRevisar').onclick = function () {
      f.obs = $('#obs').value.trim(); if ($('#motCorr')) f.motivoCorrecao = $('#motCorr').value.trim();
      var alc = Number(String(f.alcance).replace(',', '.'));
      if (f.resultado === 'Lançado' && (f.alcance === '' || isNaN(alc))) return aviso('Digite o alcance medido.', 'erro');
      if (f.resultado === 'Desclassificada' && !f.motivo) return aviso('Escolha o motivo da desclassificação.', 'erro');
      if (corr && !f.motivoCorrecao) return aviso('Escreva o motivo da correção.', 'erro');
      ir('confirmar', { mod: p.mod, equipe: e.codigo, tentativa: p.tentativa, base: p.base, f: f });
    };
  };

  TELAS.confirmar = function (el, p) {
    var e = equipe(p.equipe) || { nome: p.equipe, codigo: p.equipe };
    var f = p.f, c = cfg(), corr = !!p.base;
    var rec = {
      acao: corr ? 'corrigir' : 'registrar', substitui: corr ? p.base.id : '', equipe: e.codigo, tentativa: p.tentativa,
      resultado: f.resultado, aborto: f.aborto,
      alcance: f.resultado === 'Lançado' ? Number(String(f.alcance).replace(',', '.')) : '',
      infracoes: f.resultado === 'Lançado' ? f.infracoes : {},
      frascos: p.mod === 'N4' ? f.frascos : '', motivo: f.resultado === 'Desclassificada' ? f.motivo : '',
      obs: corr ? ('[Correção: ' + f.motivoCorrecao + '] ' + f.obs).trim() : f.obs
    };
    cabecalho('Confira antes de salvar', e.codigo + ' · ' + e.nome);
    var regs = visao();
    var jaTem = !corr && ativo(regs, e.codigo, p.tentativa);
    var infs = INFRACOES.filter(function (i) { return rec.infracoes[i.k]; }).map(function (i) { return i.nome + ' (−' + pct(c.pen[i.k]) + ')'; });
    var v = Regras.alcanceValido(rec, c);
    var html = (jaTem ? '<div class="alerta vermelho">Atenção: este lançamento já foi registrado por ' + esc(jaTem.por) + '. Se salvar, vai como CONFLITO. Para mudar o valor, volte e use Corrigir.</div>' : '') +
      '<div class="secao resumo"><dl>' +
      '<dt>Equipe</dt><dd>' + esc(e.codigo) + ' – ' + esc(e.nome) + '</dd>' +
      '<dt>Tentativa</dt><dd>' + p.tentativa + 'º lançamento</dd>' +
      '<dt>Resultado</dt><dd>' + esc(rec.resultado) + (rec.aborto ? ' · houve despressurização' : '') + '</dd>' +
      (rec.resultado === 'Lançado' ? '<dt>Alcance medido</dt><dd>' + fmt(rec.alcance) + ' m</dd>' +
        '<dt>Infrações</dt><dd>' + (infs.length ? esc(infs.join('; ')) : 'nenhuma') + '</dd>' +
        '<dt>Alcance válido</dt><dd class="alcance-final">' + fmt(v) + ' m</dd>' : '') +
      (rec.resultado === 'Desclassificada' ? '<dt>Motivo</dt><dd>' + esc(rec.motivo) + '</dd>' : '') +
      (p.mod === 'N4' ? '<dt>Frascos de vinagre</dt><dd>' + esc(rec.frascos) + '</dd>' : '') +
      (rec.obs ? '<dt>Observação</dt><dd>' + esc(rec.obs) + '</dd>' : '') +
      '<dt>Registrado por</dt><dd>' + esc(ajustes.nome) + ' · ' + esc(ajustes.dispositivo) + '</dd></dl></div><div style="height:90px"></div>' +
      '<div class="barra-acoes"><button class="botao" id="cVoltar">‹ Editar</button><button class="botao primario" id="cOk">Confirmar e salvar</button></div>';
    el.appendChild(h(html));
    $('#cVoltar').onclick = voltar;
    $('#cOk').onclick = function () {
      this.disabled = true;
      enfileirar(rec);
      aviso(status.online === false ? 'Salvo no tablet. Será enviado quando houver conexão.' : 'Salvo! Enviando…', 'ok');
      pilha = [{ tela: 'modalidade', p: {} }];
      atual = { tela: 'equipes', p: { mod: p.mod } };
      render(); window.scrollTo(0, 0);
    };
  };

  TELAS.registros = function (el, p) {
    cabecalho('Registros e correções');
    p.filtro = p.filtro || 'todos';
    var regs = visao();
    var erros = fila.filter(function (f) { return f._estado === 'erro'; });
    var filtros = [['todos', 'Todos'], ['N3', 'Nível 3'], ['N4', 'Nível 4'], ['conf', 'Conflitos'], ['pend', 'Na fila'], ['inat', 'Corrigidos/anulados']];
    var html = '<div class="filtros">' + filtros.map(function (x) { return '<button class="botao' + (p.filtro === x[0] ? ' sel' : '') + '" data-fil="' + x[0] + '">' + x[1] + '</button>'; }).join('') +
      '<button class="botao" id="rCsv">Exportar CSV</button></div>';
    if (erros.length) {
      html += '<h2>Recusados pelo servidor</h2><div class="lista-reg">' + erros.map(function (f) {
        return '<div class="reg erro"><div><div class="reg-titulo">' + esc(f.equipe) + ' · L' + esc(f.tentativa) + ' · ' + esc(textoResultado(f)) + '</div><div class="reg-det">' + esc(f._msg) + '</div></div>' +
          '<div class="acoes"><button class="botao" data-reenv="' + esc(f.id) + '">Tentar de novo</button><button class="botao perigo" data-desc="' + esc(f.id) + '">Descartar</button></div></div>';
      }).join('') + '</div>';
    }
    var lista = regs.filter(function (r) {
      var e = equipe(r.equipe) || {};
      if (p.filtro === 'N3' || p.filtro === 'N4') return e.modalidade === p.filtro;
      if (p.filtro === 'conf') return r.situacao === 'CONFLITO';
      if (p.filtro === 'pend') return r._pend;
      if (p.filtro === 'inat') return r.situacao === 'SUBSTITUÍDO' || r.situacao === 'ANULADO';
      return r.situacao === 'ATIVO' || r.situacao === 'CONFLITO';
    }).sort(function (a, b) { return String(b.registradoEm).localeCompare(String(a.registradoEm)); });
    html += '<div class="lista-reg">' + (lista.map(function (r) {
      var e = equipe(r.equipe) || { nome: '?' };
      var cls = r.situacao === 'CONFLITO' ? ' conflito' : (r.situacao !== 'ATIVO' ? ' inativo' : '') + (r._pend ? ' pendente' : '');
      var acoes = '';
      if (r.situacao === 'ATIVO') acoes = '<button class="botao" data-corr="' + esc(r.id) + '">Corrigir</button><button class="botao perigo" data-anul="' + esc(r.id) + '">Anular</button>';
      if (r.situacao === 'CONFLITO' && !r._pend) acoes = '<button class="botao" data-usar="' + esc(r.id) + '">Usar este</button><button class="botao perigo" data-anul="' + esc(r.id) + '">Descartar</button>';
      return '<div class="reg' + cls + '"><div><div class="reg-titulo">' + esc(r.equipe) + ' ' + esc(e.nome) + ' · L' + esc(r.tentativa) + ' · ' + esc(textoResultado(r)) + '</div>' +
        '<div class="reg-det">' + esc(r.situacao) + (r._pend ? ' (na fila)' : '') + ' · ' + esc(r.por) + ' · ' + hora(r.registradoEm) + (r.obs ? ' · ' + esc(r.obs) : '') + (r.motivo ? ' · ' + esc(r.motivo) : '') + '</div></div>' +
        '<div class="acoes">' + acoes + '</div></div>';
    }).join('') || '<p class="dica">Nada aqui.</p>') + '</div>';
    el.appendChild(h(html));
    el.querySelectorAll('[data-fil]').forEach(function (b) { b.onclick = function () { p.filtro = b.dataset.fil; render(); }; });
    $('#rCsv').onclick = exportarCsv;
    function achar(id) { return regs.filter(function (r) { return r.id === id; })[0]; }
    el.querySelectorAll('[data-corr]').forEach(function (b) {
      b.onclick = function () { var r = achar(b.dataset.corr), e = equipe(r.equipe) || {}; ir('formulario', { mod: e.modalidade, equipe: r.equipe, tentativa: Number(r.tentativa), base: limpar(r) }); };
    });
    el.querySelectorAll('[data-anul]').forEach(function (b) {
      b.onclick = function () {
        var r = achar(b.dataset.anul);
        var mot = prompt('Motivo para anular o registro de ' + r.equipe + ' L' + r.tentativa + ' (' + textoResultado(r) + '):');
        if (!mot) return;
        enfileirar({ acao: 'anular', substitui: r.id, equipe: r.equipe, tentativa: r.tentativa, obs: mot });
        aviso('Anulação registrada.', 'ok'); render();
      };
    });
    el.querySelectorAll('[data-usar]').forEach(function (b) {
      b.onclick = function () {
        var r = achar(b.dataset.usar), at = ativo(regs, r.equipe, Number(r.tentativa));
        if (!confirm('Usar este registro (' + textoResultado(r) + ') no lugar do atual' + (at ? ' (' + textoResultado(at) + ')' : '') + '?')) return;
        var dados = limpar(r);
        if (at) enfileirar(Object.assign({}, dados, { acao: 'corrigir', substitui: at.id, obs: ('[Conflito resolvido: usado registro ' + r.id + '] ' + (r.obs || '')).trim() }));
        else enfileirar(Object.assign({}, dados, { acao: 'registrar' }));
        enfileirar({ acao: 'anular', substitui: r.id, equipe: r.equipe, tentativa: r.tentativa, obs: 'Conflito resolvido (copiado como ativo)' });
        aviso('Conflito resolvido.', 'ok'); render();
      };
    });
    el.querySelectorAll('[data-reenv]').forEach(function (b) {
      b.onclick = function () { fila.forEach(function (f) { if (f.id === b.dataset.reenv) { f._estado = 'pendente'; delete f._msg; } }); gravar(K.fila, fila); sincronizar(); };
    });
    el.querySelectorAll('[data-desc]').forEach(function (b) {
      b.onclick = function () { if (!confirm('Descartar este registro recusado?')) return; fila = fila.filter(function (f) { return f.id !== b.dataset.desc; }); gravar(K.fila, fila); render(); atualizarPilula(); };
    });
  };

  // ------------------------------------------------------------------ exportação
  function exportarCsv() {
    var regs = visao().concat(fila.filter(function (f) { return f._estado === 'erro'; }).map(function (f) { return Object.assign({}, f, { situacao: 'RECUSADO: ' + f._msg }); }));
    var cab = ['ID', 'Registrado em', 'Registrado por', 'Dispositivo', 'Equipe', 'Nome', 'Tentativa', 'Resultado', 'Aborto', 'Alcance medido', 'Sem EPI', 'Mão/pé', 'Sem espeques', 'Gatilho<2m', 'Frascos', 'Motivo', 'Observação', 'Situação', 'Substitui', 'Alcance válido', 'Na fila'];
    var linhas = regs.map(function (r) {
      var e = equipe(r.equipe) || {}, i = r.infracoes || {}, v = Regras.alcanceValido(r, cfg());
      return [r.id, r.registradoEm, r.por, r.dispositivo || '', r.equipe, e.nome || '', r.tentativa, r.resultado, r.aborto ? 'Sim' : 'Não',
        r.alcance === '' ? '' : String(r.alcance).replace('.', ','), i.epi ? 'Sim' : 'Não', i.mao ? 'Sim' : 'Não', i.espeque ? 'Sim' : 'Não', i.gatilho ? 'Sim' : 'Não',
        r.frascos, r.motivo, r.obs, r.situacao, r.substitui, v === null ? '' : String(v).replace('.', ','), r._pend ? 'Sim' : ''];
    });
    baixar('colafog-registros-' + (ajustes ? ajustes.dispositivo : 'tablet') + '.csv', csv([cab].concat(linhas)));
  }
  function csv(linhas) {
    return '﻿' + linhas.map(function (l) { return l.map(function (v) { v = v === undefined || v === null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }).join('\r\n');
  }
  function baixar(nome, texto) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
    a.download = nome; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ------------------------------------------------------------------ início
  $('#btnVoltar').onclick = voltar;
  $('#btnMenu').onclick = function () { $('#menu').hidden = !$('#menu').hidden; };
  $('#btnSinc').onclick = function () { sincronizar(); };
  document.querySelectorAll('#menu [data-ir]').forEach(function (b) {
    b.onclick = function () { $('#menu').hidden = true; inicio(b.dataset.ir); };
  });
  window.addEventListener('online', function () { sincronizar(true); });
  window.addEventListener('offline', function () { status.online = false; atualizarPilula(); });
  setInterval(function () { if (!document.hidden) sincronizar(true); }, 20000);
  window.addEventListener('beforeunload', function (ev) {
    if (fila.some(function (f) { return f._estado !== 'erro'; })) { ev.preventDefault(); ev.returnValue = ''; }
  });
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});

  atualizarPilula();
  if (!ajustes) inicio('ajustes'); else { inicio('modalidade'); sincronizar(true); }
})();
