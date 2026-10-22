/* =========================================================================
   NOVA.JS — formulário de registro de uma nova devolução.
   ========================================================================= */
'use strict';

function prepararNova() {
  // Atualizado a cada abertura da tela: o sistema pode ficar aberto de um dia para o outro.
  $('entrega').max = hojeISO();
  atualizarAvisoPrazo();
}

/** Atualiza o resumo lateral com o prazo calculado e alerta se o pedido já estiver fora do prazo. */
function atualizarAvisoPrazo() {
  const entrega = $('entrega').value;
  const tipo = $('tipo').value;
  const aviso = $('avisoPrazo');
  if (!entrega || !tipo) {
    $('novaPrazo').textContent = '—';
    $('novaPrazoTexto').textContent = 'Informe a data de entrega e o tipo para calcular.';
    return aviso.classList.add('oculto');
  }
  const dias = PRAZO_DIAS[tipo] ?? PRAZO_PADRAO;
  const prazo = somarDias(entrega, dias);
  const restam = diasEntre(hojeISO(), prazo);
  $('novaPrazo').textContent = dataBR(prazo);
  $('novaPrazoTexto').textContent =
    `${dias} dias após a entrega · ` +
    (restam < 0 ? `vencido há ${-restam} dia(s)` : restam === 0 ? 'vence hoje' : `faltam ${restam} dia(s)`);
  aviso.classList.toggle('oculto', restam >= 0);
  aviso.textContent = `Atenção: o prazo para ${texto(
    'tipos',
    tipo,
  ).toLowerCase()} venceu em ${dataBR(prazo)} (${dias} dias após a entrega). Você ainda pode registrar, se a loja aceitar.`;
}

function salvarNova(evento) {
  evento.preventDefault();
  const f = new FormData(evento.target);
  const campo = (nome) => String(f.get(nome) || '').trim();

  if (campo('entrega') > hojeISO()) return alert('A data de entrega não pode ser no futuro.');

  const d = criarDevolucao({
    pedido: campo('pedido').replace(/^#/, ''),
    canal: campo('canal'),
    entrega: campo('entrega'),
    nfVenda: campo('nfVenda'),
    valorProduto: Number(campo('valorProduto') || 0),
    frete: Number(campo('frete') || 0),
    cliente: campo('cliente'),
    cpf: campo('cpf'),
    contato: campo('contato'),
    produto: campo('produto'),
    quantidade: Number(campo('quantidade') || 1),
    tipo: campo('tipo'),
    motivo: campo('motivo'),
    solucao: campo('solucao'),
    observacao: campo('observacao'),
  });
  evento.target.reset();
  toast(`Devolução ${d.codigo} registrada.`);
  location.hash = `#detalhe/${d.codigo}`;
}
