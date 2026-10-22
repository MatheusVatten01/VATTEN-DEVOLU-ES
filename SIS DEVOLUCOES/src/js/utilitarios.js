/* =========================================================================
   UTILITARIOS.JS — datas, dinheiro, HTML, mensagens e download de arquivos.
   ========================================================================= */
'use strict';

const $ = (id) => document.getElementById(id);

/** Data de hoje no fuso do computador, no formato AAAA-MM-DD.
    Nunca usar new Date().toISOString() para isso: é UTC e vira o dia seguinte após 21h. */
function hojeISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function somarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  return hojeISO(new Date(a, m - 1, d + dias));
}

function diasEntre(isoInicio, isoFim) {
  const [a1, m1, d1] = isoInicio.split('-').map(Number);
  const [a2, m2, d2] = isoFim.split('-').map(Number);
  return Math.round((new Date(a2, m2 - 1, d2) - new Date(a1, m1 - 1, d1)) / 86400000);
}

function dataBR(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
}

function dataHoraBR(isoCompleto) {
  if (!isoCompleto) return '—';
  return new Date(isoCompleto).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function reais(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Protege textos digitados antes de colocar no HTML. */
function esc(texto) {
  return String(texto ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function texto(grupo, chave) {
  return OPCOES[grupo][chave] ?? chave ?? '—';
}

function toast(mensagem) {
  const t = $('toast');
  t.textContent = mensagem;
  t.classList.add('toast--visivel');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('toast--visivel'), 3000);
}

/** Preenche todos os <select data-opcoes="..."> com as opções da configuração. */
function preencherSelects() {
  document.querySelectorAll('select[data-opcoes]').forEach((sel) => {
    const grupo = OPCOES[sel.dataset.opcoes];
    const todos = sel.dataset.todos ? `<option value="">${esc(sel.dataset.todos)}</option>` : '';
    sel.innerHTML =
      todos + Object.entries(grupo).map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  });
}

function baixarArquivo(nome, conteudo, tipo) {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
