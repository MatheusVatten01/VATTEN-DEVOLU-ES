/* Testes automáticos do Vatten Devoluções.
   O sistema roda dentro do iframe #app; os testes acessam o escopo global dele
   com W('expressão') (eval no iframe, mesma origem). Nenhum teste grava dados:
   salvar(), alert(), confirm() e prompt() são substituídos e o banco é restaurado. */
'use strict';

const resultados = [];
let W; // avaliador no escopo do sistema

function teste(nome, fn) {
  resultados.push({ nome, fn });
}
function igual(obtido, esperado, msg = '') {
  const a = JSON.stringify(obtido),
    b = JSON.stringify(esperado);
  if (a !== b) throw new Error(`${msg} esperado ${b}, obtido ${a}`);
}
function verdadeiro(cond, msg) {
  if (!cond) throw new Error(msg || 'condição falsa');
}
function lanca(fn, trecho, msg = '') {
  try {
    fn();
  } catch (e) {
    if (trecho && !String(e.message).includes(trecho))
      throw new Error(`${msg} erro esperado com "${trecho}", obtido "${e.message}"`);
    return;
  }
  throw new Error(`${msg} deveria ter lançado erro`);
}

/** Executa fn com banco vazio (ou o informado) e gravação neutralizada; restaura tudo depois. */
async function isolado(fn, bancoInicial = { versao: 1, proximoNumero: 1, devolucoes: [] }) {
  const win = document.getElementById('app').contentWindow;
  const bk = {
    banco: W('banco'),
    erro: W('erroCarregamento'),
    hash: win.location.hash,
    salvar: win.salvar,
    alert: win.alert,
    confirm: win.confirm,
    prompt: win.prompt,
    chamarPonte: win.chamarPonte,
    configML: win.configML,
    salvarConfigML: win.salvarConfigML,
  };
  win.__novo = JSON.parse(JSON.stringify(bancoInicial));
  W('banco = __novo; erroCarregamento = "";');
  win.salvar = () => true;
  win.alert = () => {};
  win.confirm = () => true;
  win.prompt = () => null;
  // Integração ML: nunca chama a ponte de verdade nem grava a configuração real.
  win.chamarPonte = async () => {
    throw new Error('ponte não disponível nos testes');
  };
  let cfgTeste = {};
  win.configML = () => ({ ...cfgTeste });
  win.salvarConfigML = (c) => ((cfgTeste = { ...c }), true);
  try {
    return await fn(win);
  } finally {
    win.__bk = bk.banco;
    W('banco = __bk');
    W(`erroCarregamento = ${JSON.stringify(bk.erro)}`);
    Object.assign(win, {
      salvar: bk.salvar,
      alert: bk.alert,
      confirm: bk.confirm,
      prompt: bk.prompt,
      chamarPonte: bk.chamarPonte,
      configML: bk.configML,
      salvarConfigML: bk.salvarConfigML,
    });
    delete win.__novo;
    delete win.__bk;
    if (win.location.hash !== bk.hash) win.location.hash = bk.hash;
  }
}

/** Campos de uma devolução de teste (entrega informada, padrão arrependimento). */
function camposTeste(ajustes = {}) {
  return {
    pedido: '1001',
    canal: 'loja',
    entrega: '2026-10-01',
    valorProduto: 199.9,
    frete: 25,
    cliente: 'CLIENTE TESTE',
    cpf: '',
    contato: '',
    produto: 'SKU-1 Produto teste',
    quantidade: 1,
    tipo: 'arrependimento',
    motivo: 'tamanho',
    solucao: 'reembolso',
    observacao: '',
    ...ajustes,
  };
}
const criar = (win, ajustes) => win.criarDevolucao(camposTeste(ajustes));

/* ===================== Inicialização ===================== */
teste('Sistema abre sem erro de leitura dos dados', () => {
  igual(W('erroCarregamento'), '', 'erroCarregamento');
  verdadeiro(document.getElementById('app').contentDocument.querySelector('.tela--ativa'), 'nenhuma tela ativa');
});
teste('Selects são preenchidos com as opções da configuração', () => {
  const doc = document.getElementById('app').contentDocument;
  igual(doc.getElementById('tipo').options.length, Object.keys(W('OPCOES.tipos')).length, 'tipo');
  igual(doc.getElementById('filtroStatus').options[0].textContent, 'Todos', 'filtro com "Todos"');
});
teste('Todas as telas renderizam sem erro (com e sem devoluções)', () =>
  isolado((win) => {
    win.renderPainel();
    win.renderLista();
    win.prepararNova();
    const d = criar(win);
    win.renderPainel();
    win.renderLista();
    win.renderDetalhe(d.codigo);
    igual(win.document.getElementById('detTitulo').textContent, `Devolução ${d.codigo}`);
  }));

/* ===================== Datas ===================== */
teste('Data de hoje usa o fuso local, não UTC', () => {
  // 31/10/2026 às 22:30 no Brasil = 01/11/2026 em UTC.
  igual(W('hojeISO(new Date(2026, 9, 31, 22, 30))'), '2026-10-31');
});
teste('somarDias e diasEntre atravessam mês e ano', () => {
  igual(W("somarDias('2026-12-28', 7)"), '2027-01-04');
  igual(W("somarDias('2028-02-28', 1)"), '2028-02-29', 'ano bissexto');
  igual(W("diasEntre('2026-10-01', '2026-10-08')"), 7);
  igual(W("diasEntre('2026-10-08', '2026-10-01')"), -7);
});
teste('dataBR formata e trata vazio', () => {
  igual(W("dataBR('2026-10-05')"), '05/10/2026');
  igual(W("dataBR('')"), '—');
});

/* ===================== Prazos ===================== */
teste('Prazo: arrependimento 7 dias, defeito 90, troca 30, tipo desconhecido 30', () => {
  const prazo = (tipo) => W('prazoDe')({ entrega: '2026-10-01', tipo });
  igual(prazo('arrependimento'), '2026-10-08');
  igual(prazo('defeito'), '2026-12-30');
  igual(prazo('troca'), '2026-10-31');
  igual(prazo('xyz'), '2026-10-31');
});

/* ===================== Fluxo da devolução ===================== */
teste('Códigos são sequenciais a partir de DV-0001', () =>
  isolado((win) => {
    igual(criar(win).codigo, 'DV-0001');
    igual(criar(win).codigo, 'DV-0002');
    igual(W('banco.proximoNumero'), 3);
  }));
teste('Nova devolução começa como solicitada, com abertura hoje e histórico', () =>
  isolado((win) => {
    const d = criar(win);
    igual(d.status, 'solicitada');
    igual(d.abertura, W('hojeISO()'));
    igual(d.historico.length, 1);
  }));
teste('Fluxo completo: aprovada → em trânsito (rastreio obrigatório) → inspeção → concluída', () =>
  isolado((win) => {
    const d = criar(win);
    igual(win.avancar(d), 'aprovada');
    lanca(() => win.avancar(d, '   '), 'rastreio', 'sem rastreio:');
    igual(d.status, 'aprovada', 'continua aprovada após erro');
    igual(win.avancar(d, ' AR123456789BR '), 'transito');
    igual(d.rastreio, 'AR123456789BR');
    igual(d.historico.at(-1).nota, 'Rastreio AR123456789BR');
    igual(win.avancar(d), 'inspecao');
    lanca(() => win.avancar(d), 'não pode avançar', 'inspeção não avança pelo botão:');
    win.concluir(d, { estado: 'A', destino: 'estoque', resolucao: 'troca', valorReembolso: '0', cfop: '1202' });
    igual(d.status, 'concluida');
    igual(d.historico.map((h) => h.status), ['solicitada', 'aprovada', 'transito', 'inspecao', 'concluida']);
    lanca(() => win.concluir(d, {}), 'não está em inspeção', 'concluir duas vezes:');
  }));
teste('Recusa exige motivo e não vale para devolução encerrada', () =>
  isolado((win) => {
    const d = criar(win);
    lanca(() => win.recusarDevolucao(d, '  '), 'motivo');
    win.recusarDevolucao(d, 'Fora do prazo');
    igual([d.status, d.parecer], ['recusada', 'Fora do prazo']);
    lanca(() => win.recusarDevolucao(d, 'de novo'), 'encerrada');
  }));
teste('Excluir remove só a devolução indicada', () =>
  isolado((win) => {
    criar(win);
    criar(win);
    win.excluirDevolucao('DV-0001');
    igual(W('banco.devolucoes.map(d => d.codigo)'), ['DV-0002']);
  }));

/* ===================== Painel ===================== */
teste('Painel conta devoluções do mês, abertas e % de troca/crédito', () =>
  isolado((win) => {
    const doc = win.document;
    const a = criar(win);
    const b = criar(win);
    criar(win);
    for (const d of [a, b]) {
      win.avancar(d);
      win.avancar(d, 'X1');
      win.avancar(d);
    }
    win.concluir(a, { resolucao: 'credito' });
    win.concluir(b, { resolucao: 'reembolso' });
    doc.getElementById('painelMes').value = W('hojeISO().slice(0, 7)');
    win.renderPainel();
    igual(doc.getElementById('kpiTotal').textContent, '3', 'total');
    igual(doc.getElementById('kpiAbertas').textContent, '1', 'abertas');
    igual(doc.getElementById('kpiTroca').textContent, '50%', 'troca/crédito');
    const funil = [...doc.querySelectorAll('#painelFunil .funil__etapa')].map((b) => [
      b.dataset.status,
      b.querySelector('.funil__qtd').textContent,
    ]);
    igual(funil, [
      ['solicitada', '1'],
      ['aprovada', '0'],
      ['transito', '0'],
      ['inspecao', '0'],
      ['concluida', '2'],
    ]);
  }));
teste('Clicar numa etapa do funil abre a lista filtrada por aquele status', () =>
  isolado((win) => {
    const doc = win.document;
    const a = criar(win);
    criar(win);
    win.avancar(a);
    doc.getElementById('painelMes').value = W('hojeISO().slice(0, 7)');
    win.renderPainel();
    doc.querySelector('#painelFunil [data-status="aprovada"]').click();
    igual(doc.getElementById('filtroStatus').value, 'aprovada');
    win.renderLista(); // o hashchange é assíncrono; renderiza direto para conferir
    igual(doc.querySelectorAll('#listaCorpo tr').length, 1, 'linhas');
    win.limparFiltros();
  }));
teste('Nova devolução: resumo lateral mostra o prazo e avisa quando vencido', () =>
  isolado((win) => {
    const doc = win.document;
    doc.getElementById('tipo').value = 'arrependimento';
    doc.getElementById('entrega').value = W('somarDias(hojeISO(), -3)');
    win.atualizarAvisoPrazo();
    igual(doc.getElementById('novaPrazo').textContent, W('dataBR(somarDias(hojeISO(), 4))'));
    verdadeiro(doc.getElementById('avisoPrazo').classList.contains('oculto'), 'aviso não deveria aparecer');
    doc.getElementById('entrega').value = W('somarDias(hojeISO(), -10)');
    win.atualizarAvisoPrazo();
    verdadeiro(!doc.getElementById('avisoPrazo').classList.contains('oculto'), 'aviso deveria aparecer');
    verdadeiro(doc.getElementById('novaPrazoTexto').textContent.includes('vencido há 3'), 'texto vencido');
    doc.getElementById('formNova').reset();
  }));

/* ===================== Segurança e dados ===================== */
teste('Texto do usuário é escapado no HTML', () =>
  isolado((win) => {
    igual(W('esc')('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
    criar(win, { cliente: '<img src=x onerror=alert(1)>' });
    win.renderLista();
    verdadeiro(!win.document.querySelector('#listaCorpo img'), 'HTML do cliente foi interpretado');
  }));
teste('migrarBanco corrige próximo número menor que o maior código e rejeita arquivo inválido', () => {
  const m = W('migrarBanco')({ proximoNumero: 2, devolucoes: [{ codigo: 'DV-0007' }] });
  igual(m.proximoNumero, 8);
  igual(m.devolucoes[0].historico, [], 'histórico ausente vira lista');
  lanca(() => W('migrarBanco')({}), 'sem lista');
  lanca(() => W('migrarBanco')({ devolucoes: [{}] }), 'sem código');
});
teste('Falha ao ler dados salvos bloqueia a gravação (não apaga o que existe)', () => {
  const win = document.getElementById('app').contentWindow;
  const alerta = win.alert;
  let avisou = false;
  win.alert = () => (avisou = true);
  try {
    W('erroCarregamento = "teste"');
    igual(win.salvar(), false, 'salvar()');
    verdadeiro(avisou, 'usuário não foi avisado');
  } finally {
    W('erroCarregamento = ""');
    win.alert = alerta;
  }
});

/* ===================== Backup e CSV ===================== */
teste('Backup tem marca de formato e volta igual na restauração', () =>
  isolado((win) => {
    criar(win);
    const texto = win.gerarBackup();
    igual(JSON.parse(texto).formato, 'VATTEN_DEVOLUCOES_V1');
    const lido = win.lerBackup(texto);
    igual(lido.devolucoes, W('banco.devolucoes'));
    igual(lido.proximoNumero, 2);
    verdadeiro(!texto.includes('chave'), 'backup não pode levar a chave da ponte');
  }));
teste('Restauração aceita backup do esboço (sem formato) e rejeita outro sistema', () => {
  const lerBackup = W('lerBackup');
  igual(lerBackup('{"proximoNumero":1,"devolucoes":[]}').devolucoes, []);
  lanca(() => lerBackup('{"format":"x","formato":"VATTEN_PLR_V1","devolucoes":[]}'), 'outro sistema');
  lanca(() => lerBackup('não é json'));
});
teste('CSV: separador ;, vírgula decimal, aspas quando necessário e BOM', () =>
  isolado((win) => {
    criar(win, { cliente: 'Silva; "Zé"', valorProduto: 199.9 });
    const csv = win.gerarCsv(W('banco.devolucoes'));
    verdadeiro(csv.startsWith('﻿Código;Abertura;'), 'cabeçalho/BOM');
    const linha = csv.split('\r\n')[1];
    verdadeiro(linha.includes(';"Silva; ""Zé""";'), 'aspas: ' + linha);
    verdadeiro(linha.includes(';199,9;'), 'decimal: ' + linha);
  }));

/* ===================== Mercado Livre ===================== */

/** Pacote como a ponte devolve; claim/devolução baseados nos exemplos da documentação do ML. */
function pacoteML({ claimId = 5298178312, status = 'delivered', destino = 'seller_address', acoes, atualizado } = {}) {
  return {
    claim: {
      id: claimId,
      resource_id: 2000009229357366,
      resource: 'order',
      type: 'mediations',
      reason_id: 'PDD9549',
      claimed_quantity: 1,
      date_created: '2026-10-10T10:00:00.000-03:00',
      last_updated: atualizado || '2026-10-15T10:00:00.000-03:00',
      related_entities: ['return'],
      players: [
        { role: 'complainant', type: 'buyer', user_id: 1, available_actions: [] },
        {
          role: 'respondent',
          type: 'seller',
          user_id: 2,
          available_actions: acoes ?? [
            { action: 'return_review_ok', due_date: '2026-10-24T23:59:00.000-03:00', mandatory: false },
            { action: 'return_review_fail', due_date: '2026-10-24T23:59:00.000-03:00', mandatory: false },
          ],
        },
      ],
    },
    devolucao: {
      id: 57341011,
      status,
      status_money: 'retained',
      refund_at: 'delivered',
      date_created: '2026-10-12T16:24:26.636+00:00',
      claim_id: claimId,
      shipments: [
        { shipment_id: 43810672299, status: 'delivered', tracking_number: 'ML123BR', destination: { name: destino }, type: 'return' },
      ],
      orders: [{ order_id: 2000009229357366, item_id: 'MLB3840513395', return_quantity: '1.0', total_quantity: '1.0' }],
      related_entities: [],
    },
    detalhe: { title: 'Devolução a caminho', description: 'Revise quando chegar', problem: 'Chegou com defeito' },
    custo: { currency_id: 'BRL', amount: 42.9 },
    pedido: {
      id: 2000009229357366,
      order_items: [{ item: { id: 'MLB3840513395', title: 'Purificador VT-300', seller_sku: 'VT-300' }, quantity: 1, unit_price: 189.9 }],
      buyer: { id: 1, nickname: 'COMPRADOR123', first_name: 'Maria', last_name: 'Silva' },
      shipping: { id: 999 },
    },
    envio: { status_history: { date_delivered: '2026-10-05T14:00:00.000-03:00' } },
  };
}

teste('Banco antigo (v1) ganha origem "manual" na migração', () => {
  const m = W('migrarBanco')({ proximoNumero: 2, devolucoes: [{ codigo: 'DV-0001', historico: [] }] });
  igual(m.devolucoes[0].origem, 'manual');
  igual(m.versao, 2);
});
teste('ML: conversão do pacote preenche pedido, cliente, produto, valores e dados do ML', () => {
  const c = W('converterDevolucaoML')(pacoteML());
  igual(c.campos.pedido, '2000009229357366');
  igual(c.campos.canal, 'mercadolivre');
  igual(c.campos.cliente, 'Maria Silva');
  igual(c.campos.produto, 'VT-300 · Purificador VT-300');
  igual(c.campos.valorProduto, 189.9);
  igual(c.campos.frete, 42.9);
  igual(c.campos.tipo, 'defeito', 'PDD = defeito');
  igual(c.campos.entrega, '2026-10-05');
  igual(c.rastreio, 'ML123BR');
  igual(c.etapa, 'inspecao', 'delivered = em inspeção');
  igual([c.ml.claimId, c.ml.returnId, c.ml.podeRevisar, c.ml.triagem], ['5298178312', '57341011', true, false]);
  igual(c.ml.prazoRevisao, '2026-10-24T23:59:00.000-03:00');
});
teste('ML: status do ML vira a etapa certa', () => {
  const etapa = (status) => W('converterDevolucaoML')(pacoteML({ status })).etapa;
  igual(
    ['pending', 'label_generated', 'shipped', 'delivered', 'cancelled', 'expired', 'xyz'].map(etapa),
    ['aprovada', 'aprovada', 'transito', 'inspecao', 'cancelada', 'cancelada', 'solicitada'],
  );
});
teste('ML: importar cria com selo ML e linha do tempo completa; importar de novo não duplica nem apaga o parecer', () =>
  isolado((win) => {
    igual(win.aplicarPacoteML(pacoteML({ status: 'shipped' })), 'nova');
    const d = W('banco.devolucoes[0]');
    igual([d.origem, d.status, d.rastreio], ['mercadolivre', 'transito', 'ML123BR']);
    igual(d.historico.map((h) => h.status), ['solicitada', 'aprovada', 'transito']);
    d.parecer = 'anotação da equipe';
    igual(win.aplicarPacoteML(pacoteML({ status: 'delivered' })), 'atualizada');
    igual(W('banco.devolucoes.length'), 1, 'não duplicou');
    igual([d.status, d.parecer], ['inspecao', 'anotação da equipe']);
  }));
teste('ML: cancelamento no ML encerra devolução aberta, mas não mexe em concluída', () =>
  isolado((win) => {
    win.aplicarPacoteML(pacoteML({ claimId: 1, status: 'shipped' }));
    win.aplicarPacoteML(pacoteML({ claimId: 1, status: 'cancelled' }));
    igual(W('banco.devolucoes[0].status'), 'cancelada');
    win.aplicarPacoteML(pacoteML({ claimId: 2, status: 'delivered' }));
    const d = W('banco.devolucoes[1]');
    win.concluir(d, { estado: 'A', resolucao: 'reembolso' });
    win.aplicarPacoteML(pacoteML({ claimId: 2, status: 'cancelled' }));
    igual(d.status, 'concluida');
  }));
teste('ML: corpo da revisão — OK é {}, falha exige motivo, parecer e anexo para SRF2/SRF4', () => {
  const montar = W('montarRevisaoML');
  igual(montar({}, { resultado: 'ok' }), {});
  lanca(() => montar({}, { resultado: 'falha', mensagem: 'x' }), 'motivo');
  lanca(() => montar({}, { resultado: 'falha', motivo: 'SRF3', mensagem: ' ' }), 'parecer');
  lanca(() => montar({}, { resultado: 'falha', motivo: 'SRF2', mensagem: 'quebrado' }), 'evidência');
  igual(montar({}, { resultado: 'falha', motivo: 'SRF3', mensagem: 'faltou peça' }), [
    { reason: 'SRF3', message: 'faltou peça' },
  ]);
  igual(montar({}, { resultado: 'falha', motivo: 'SRF2', mensagem: 'quebrado', anexos: ['a.png'] }), [
    { reason: 'SRF2', message: 'quebrado', attachments: ['a.png'] },
  ]);
});
teste('ML: concluir marca a revisão como pendente e o envio bem-sucedido vira "enviada"', () =>
  isolado(async (win) => {
    win.aplicarPacoteML(pacoteML());
    const d = W('banco.devolucoes[0]');
    const chamadas = [];
    win.chamarPonte = async (caminho, op = {}) => (chamadas.push([caminho, op.method || 'GET', op.body]), { ok: true });
    win.concluir(d, { estado: 'A', resolucao: 'reembolso', parecer: 'ok', revisaoML: { tipo: 'ok', motivo: '', anexos: [] } });
    igual(d.ml.revisao.situacao, 'pendente');
    igual(await win.enviarRevisaoML(d), true);
    igual(d.ml.revisao.situacao, 'enviada');
    igual(chamadas, [['/revisao/57341011?claimId=5298178312', 'POST', '{}']]);
  }));
teste('ML: com falha e foto, envia o anexo antes e usa o nome devolvido pelo ML', () =>
  isolado(async (win) => {
    win.aplicarPacoteML(pacoteML());
    const d = W('banco.devolucoes[0]');
    const caminhos = [];
    win.chamarPonte = async (caminho, op = {}) => {
      caminhos.push(caminho);
      return caminho.startsWith('/anexos/') ? { fileName: 'ml_123.png' } : { ok: true };
    };
    win.concluir(d, { estado: 'C', parecer: 'tela quebrada', revisaoML: { tipo: 'falha', motivo: 'SRF2', anexos: [] } });
    const foto = new win.File(['x'], 'foto 1.png', { type: 'image/png' });
    igual(await win.enviarRevisaoML(d, [foto]), true);
    igual(caminhos, ['/anexos/5298178312', '/revisao/57341011?claimId=5298178312']);
    igual(d.ml.revisao.anexos, ['ml_123.png']);
  }));
teste('ML: se a ponte falhar, a devolução fica concluída e a revisão em "erro" com a mensagem', () =>
  isolado(async (win) => {
    win.aplicarPacoteML(pacoteML());
    const d = W('banco.devolucoes[0]');
    win.concluir(d, { estado: 'A', parecer: 'ok', revisaoML: { tipo: 'ok', motivo: '', anexos: [] } });
    igual(await win.enviarRevisaoML(d), false);
    igual([d.status, d.ml.revisao.situacao, d.ml.revisao.ultimoErro], ['concluida', 'erro', 'ponte não disponível nos testes']);
    igual(d.ml.revisao.tentativas, 1);
  }));
teste('ML: sincronização importa as novas e pula as que não mudaram', () =>
  isolado(async (win) => {
    const pedidos = [];
    win.configML = () => ({ url: 'https://ponte.teste', chave: 'x' });
    win.chamarPonte = async (caminho) => {
      pedidos.push(caminho);
      if (caminho.startsWith('/devolucoes?'))
        return { devolucoes: [{ claimId: 5298178312, atualizadoEm: '2026-10-15T10:00:00.000-03:00' }] };
      return pacoteML();
    };
    igual(await win.sincronizarML({ silencioso: true }), { novas: 1, atualizadas: 0, erros: 0 });
    igual(await win.sincronizarML({ silencioso: true }), { novas: 0, atualizadas: 0, erros: 0 }, '2ª vez:');
    igual(pedidos.filter((p) => p.startsWith('/devolucoes/')).length, 1, 'pacote buscado uma vez só');
  }));
teste('ML: devolução para o depósito do ML (triagem) não mostra o formulário de revisão', () =>
  isolado((win) => {
    win.aplicarPacoteML(pacoteML({ destino: 'warehouse' }));
    const d = W('banco.devolucoes[0]');
    igual(win.revisaoMLAplicavel(d), false);
    win.renderDetalhe(d.codigo);
    verdadeiro(win.document.getElementById('camposML').classList.contains('oculto'), 'campos ML visíveis');
    verdadeiro(!win.document.getElementById('avisoTriagemML').classList.contains('oculto'), 'aviso de triagem escondido');
  }));
teste('ML: detalhe mostra o bloco ML, esconde "Avançar" e oferece Reenviar após erro', () =>
  isolado(async (win) => {
    const doc = win.document;
    win.aplicarPacoteML(pacoteML({ status: 'shipped' }));
    const d = W('banco.devolucoes[0]');
    win.renderDetalhe(d.codigo);
    verdadeiro(!doc.getElementById('detBlocoML').classList.contains('oculto'), 'bloco ML escondido');
    verdadeiro(doc.getElementById('detBlocoAvancar').classList.contains('oculto'), 'Avançar visível em devolução do ML');
    win.aplicarPacoteML(pacoteML({ status: 'delivered' }));
    win.concluir(d, { estado: 'A', parecer: 'ok', revisaoML: { tipo: 'ok', motivo: '', anexos: [] } });
    await win.enviarRevisaoML(d);
    win.renderDetalhe(d.codigo);
    verdadeiro(!doc.getElementById('acoesReenvioML').classList.contains('oculto'), 'botão Reenviar escondido');
    win.renderLista();
    verdadeiro(doc.querySelector('#listaCorpo .selo-ml--alerta'), 'selo de alerta na lista');
  }));

/* ===================== Execução ===================== */
async function rodar() {
  const resumo = document.getElementById('resumo'),
    lista = document.getElementById('lista');
  let ok = 0,
    falha = 0;
  for (const t of resultados) {
    let detalhe = '',
      passou = true;
    try {
      await t.fn();
    } catch (e) {
      passou = false;
      detalhe = e.message;
    }
    passou ? ok++ : falha++;
    t.passou = passou;
    t.detalhe = detalhe;
    lista.insertAdjacentHTML(
      'beforeend',
      `<tr><td class="${passou ? 'ok' : 'falha'}">${passou ? '✓ OK' : '✗ FALHOU'}</td><td>${t.nome}</td><td>${detalhe
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</td></tr>`,
    );
  }
  resumo.className = falha ? 'falha' : 'ok';
  resumo.textContent = `${ok} de ${ok + falha} testes passaram${falha ? ` · ${falha} falharam` : ''}.`;
  window.resultadoTestes = { ok, falha, falhas: resultados.filter((t) => !t.passou).map((t) => [t.nome, t.detalhe]) };
}

document.getElementById('app').addEventListener('load', () => {
  const win = document.getElementById('app').contentWindow;
  W = (expr) => win.eval(expr);
  rodar();
});
