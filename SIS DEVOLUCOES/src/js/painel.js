/* =========================================================================
   PAINEL.JS — indicadores do mês, motivos e prazos mais próximos.
   ========================================================================= */
'use strict';

function renderPainel() {
  const mes = $('painelMes').value || hojeISO().slice(0, 7);
  $('painelMes').value = mes;
  const doMes = banco.devolucoes.filter((d) => d.abertura.startsWith(mes));
  const abertas = banco.devolucoes.filter((d) => ABERTAS.includes(d.status));
  const vencendo = abertas.filter((d) => diasRestantes(d) <= 1);
  const resolvidas = doMes.filter((d) => d.status === 'concluida');
  const mantidas = resolvidas.filter((d) => ['troca', 'credito'].includes(d.resolucao));
  const frete = doMes.reduce((s, d) => s + Number(d.frete || 0), 0);

  const [ano, m] = mes.split('-');
  $('painelDescricao').textContent = `Resumo de ${new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
  })}`;
  $('kpiTotal').textContent = doMes.length;
  $('kpiTotalRodape').textContent = `${resolvidas.length} concluída(s) no mês`;
  $('kpiAbertas').textContent = abertas.length;
  $('kpiAbertasRodape').textContent = `${vencendo.length} com prazo vencendo ou vencido`;
  $('kpiTroca').textContent = resolvidas.length
    ? `${Math.round((mantidas.length / resolvidas.length) * 100)}%`
    : '0%';
  $('kpiFrete').textContent = reais(frete);
  $('kpiFreteRodape').textContent = `Média ${reais(doMes.length ? frete / doMes.length : 0)} por devolução`;

  // Alerta do Mercado Livre: revisões que precisam de atenção (o ML reembolsa 3 dias após o recebimento)
  const mlInspecao = abertas.filter((d) => d.status === 'inspecao' && revisaoMLAplicavel(d)).length;
  const mlFalhas = banco.devolucoes.filter((d) => ['erro', 'pendente'].includes(d.ml?.revisao?.situacao)).length;
  const avisosML = [
    mlInspecao && `${mlInspecao} devolução(ões) do Mercado Livre aguardando inspeção — o ML reembolsa o comprador 3 dias após o recebimento`,
    mlFalhas && `${mlFalhas} revisão(ões) não chegaram ao Mercado Livre — abra a devolução e clique em Reenviar`,
  ].filter(Boolean);
  $('painelAvisoML').classList.toggle('oculto', !avisosML.length);
  $('painelAvisoML').textContent = avisosML.join(' · ');

  // Funil: quantas devoluções estão em cada etapa aberta (todas as datas) + concluídas no mês
  const etapasFunil = [
    ...ABERTAS.map((st) => [st, abertas.filter((d) => d.status === st).length]),
    ['concluida', resolvidas.length],
  ];
  $('painelFunil').innerHTML = etapasFunil
    .map(
      ([st, qtd]) => `
        <button class="funil__etapa" type="button" data-status="${esc(st)}">
          <span class="funil__qtd">${qtd}</span>
          <span class="funil__nome">${esc(texto('status', st))}${st === 'concluida' ? ' no mês' : ''}</span>
        </button>`,
    )
    .join('');

  // Motivos do mês, do mais frequente para o menos frequente
  const contagem = {};
  doMes.forEach((d) => (contagem[d.motivo] = (contagem[d.motivo] || 0) + 1));
  const motivos = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  const maior = motivos[0]?.[1] || 1;
  $('painelMotivos').innerHTML = motivos.length
    ? motivos
        .map(
          ([chave, qtd]) => `
        <div class="barra">
          <div class="barra__linha"><span>${esc(texto('motivos', chave))}</span><span>${qtd}</span></div>
          <div class="barra__trilho"><div class="barra__preenchido" style="width:${Math.round(
            (qtd / maior) * 100,
          )}%"></div></div>
        </div>`,
        )
        .join('')
    : '<div class="vazio">Nenhuma devolução neste mês.</div>';

  // Prazos mais próximos entre as devoluções em aberto
  const proximos = abertas
    .slice()
    .sort((a, b) => diasRestantes(a) - diasRestantes(b))
    .slice(0, 6);
  $('painelPrazos').innerHTML = proximos.length
    ? proximos
        .map(
          (d) => `
        <tr>
          <td><a href="#detalhe/${esc(d.codigo)}">${esc(d.codigo)}</a></td>
          <td>${esc(d.cliente)}</td>
          <td class="${diasRestantes(d) <= 1 ? 'prazo-alerta' : ''}">${textoPrazo(d)}</td>
        </tr>`,
        )
        .join('')
    : '<tr><td colspan="3" class="vazio">Nenhuma devolução em aberto.</td></tr>';
}

function textoPrazo(d) {
  const dias = diasRestantes(d);
  if (dias < 0) return `Vencido há ${-dias} dia(s)`;
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Amanhã';
  return `${dataBR(prazoDe(d))} (${dias} dias)`;
}
