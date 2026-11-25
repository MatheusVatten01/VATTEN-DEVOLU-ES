/* =========================================================================
   DADOS.JS — banco (localStorage), migração e regras do fluxo da devolução.
   As funções de regra (avancar, concluir, recusarDevolucao...) não mexem na
   tela: lançam Error com a mensagem para o usuário e quem chama mostra.
   ========================================================================= */
'use strict';

let banco = { versao: VERSAO_BANCO, proximoNumero: 1, devolucoes: [] };
// Preenchido se os dados salvos não puderam ser lidos. Enquanto houver erro,
// salvar() fica bloqueado para não sobrescrever os dados originais com um banco vazio.
let erroCarregamento = '';

/** Normaliza um banco vindo do localStorage ou de um backup. Lança Error se for inválido. */
function migrarBanco(dados) {
  if (!dados || !Array.isArray(dados.devolucoes)) throw new Error('formato inválido (sem lista de devoluções)');
  const devolucoes = dados.devolucoes.map((d, i) => {
    if (!d || typeof d.codigo !== 'string' || !d.codigo) throw new Error(`devolução nº ${i + 1} sem código`);
    return {
      ...d,
      origem: d.origem || 'manual',
      historico: Array.isArray(d.historico) ? d.historico : [],
    };
  });
  // Garante que o próximo código nunca repita um já existente.
  const maior = devolucoes.reduce((m, d) => Math.max(m, Number(d.codigo.replace(/\D/g, '')) || 0), 0);
  const proximo = Number.isInteger(dados.proximoNumero) ? dados.proximoNumero : 1;
  return { versao: VERSAO_BANCO, proximoNumero: Math.max(proximo, maior + 1), devolucoes };
}

function carregar() {
  try {
    const bruto = localStorage.getItem(CHAVE_ARMAZENAMENTO);
    if (bruto) banco = migrarBanco(JSON.parse(bruto));
  } catch (erro) {
    console.error(erro);
    erroCarregamento = erro.message || String(erro);
    alert(
      'Não foi possível ler os dados salvos (' +
        erroCarregamento +
        '). Nada será gravado nesta sessão para não apagar o que existe. Restaure um backup ou peça suporte.',
    );
  }
}

/** Grava o banco. Retorna false se não gravou. */
function salvar() {
  if (erroCarregamento) {
    alert('Gravação bloqueada: os dados salvos não puderam ser lidos ao abrir o sistema. Restaure um backup.');
    return false;
  }
  try {
    localStorage.setItem(CHAVE_ARMAZENAMENTO, JSON.stringify(banco));
    return true;
  } catch (erro) {
    console.error(erro);
    alert('Não foi possível salvar. Faça um backup agora para não perder dados.');
    return false;
  }
}

function buscar(codigo) {
  return banco.devolucoes.find((d) => d.codigo === codigo);
}

/** Prazo da devolução (AAAA-MM-DD), ou '' quando ainda não há prazo correndo.
    Manual: prazo do cliente para devolver (entrega + dias do tipo).
    Mercado Livre: prazo da equipe para revisar o produto — ver prazoRevisaoML(). */
function prazoDe(d) {
  if (d.origem === 'mercadolivre') return prazoRevisaoML(d);
  return somarDias(d.entrega, PRAZO_DIAS[d.tipo] ?? PRAZO_PADRAO);
}

/** Devolução do ML: o comprador já foi aprovado pelo ML, então o prazo do CDC (entrega + 90 dias
    para defeito) não vale. O que corre é o prazo para revisar: PRAZO_REVISAO_ML_DIAS após o produto
    chegar (entrada em "Em inspeção"), nunca depois da data que o próprio ML informar.
    Antes de o produto chegar não há prazo. */
function prazoRevisaoML(d) {
  const chegada = (d.historico || []).find((h) => h.status === 'inspecao')?.em;
  const chegou = chegada ? new Date(chegada) : null;
  const porChegada = chegou && !isNaN(chegou) ? somarDias(hojeISO(chegou), PRAZO_REVISAO_ML_DIAS) : '';
  const informado = d.ml?.prazoRevisao ? new Date(d.ml.prazoRevisao) : null;
  const doML = informado && !isNaN(informado) ? hojeISO(informado) : '';
  if (porChegada && doML) return doML < porChegada ? doML : porChegada;
  return porChegada || doML;
}

/** Dias que faltam até o prazo (negativo = vencido; Infinity = sem prazo correndo). */
function diasRestantes(d) {
  const prazo = prazoDe(d);
  return prazo ? diasEntre(hojeISO(), prazo) : Infinity;
}

function registrarEtapa(d, status, nota = '') {
  d.status = status;
  d.historico.push({ status, em: new Date().toISOString(), nota });
}

function criarDevolucao(campos) {
  const codigo = `DV-${String(banco.proximoNumero).padStart(4, '0')}`;
  banco.proximoNumero += 1;
  const d = {
    codigo,
    abertura: hojeISO(),
    origem: 'manual',
    ...campos,
    status: 'solicitada',
    historico: [],
  };
  registrarEtapa(d, 'solicitada', d.origem === 'mercadolivre' ? 'via Mercado Livre' : '');
  banco.devolucoes.push(d);
  salvar();
  return d;
}

/** Leva a devolução para a próxima etapa. Ao registrar o envio, o rastreio é obrigatório. */
function avancar(d, rastreio = '') {
  if (!BOTAO_AVANCAR[d.status])
    throw new Error(`${d.codigo} não pode avançar a partir de "${texto('status', d.status)}".`);
  let nota = '';
  if (d.status === 'aprovada') {
    const codigo = String(rastreio || '').trim();
    if (!codigo) throw new Error('Informe o código de postagem ou rastreio.');
    d.rastreio = codigo;
    nota = `Rastreio ${codigo}`;
  }
  const proxima = ETAPAS[ETAPAS.indexOf(d.status) + 1];
  registrarEtapa(d, proxima, nota);
  salvar();
  return proxima;
}

/** Encerra a inspeção com a resolução escolhida. */
function concluir(d, campos) {
  if (d.status !== 'inspecao') throw new Error(`${d.codigo} não está em inspeção.`);
  Object.assign(d, {
    estado: campos.estado,
    destino: campos.destino,
    resolucao: campos.resolucao,
    valorReembolso: Number(campos.valorReembolso || 0),
    cfop: campos.cfop,
    nfEntrada: String(campos.nfEntrada || '').trim(),
    parecer: String(campos.parecer || '').trim(),
  });
  if (campos.revisaoML) d.ml.revisao = { ...d.ml.revisao, ...campos.revisaoML, situacao: 'pendente' };
  registrarEtapa(d, 'concluida', texto('solucoes', d.resolucao));
  salvar();
}

function recusarDevolucao(d, motivo) {
  if (!ABERTAS.includes(d.status)) throw new Error(`${d.codigo} já está encerrada.`);
  const parecer = String(motivo || '').trim();
  if (!parecer) throw new Error('Informe o motivo da recusa.');
  d.parecer = parecer;
  registrarEtapa(d, 'recusada', parecer);
  salvar();
}

function excluirDevolucao(codigo) {
  banco.devolucoes = banco.devolucoes.filter((x) => x.codigo !== codigo);
  salvar();
}
