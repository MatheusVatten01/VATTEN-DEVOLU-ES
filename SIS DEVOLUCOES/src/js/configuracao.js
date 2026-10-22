/* =========================================================================
   CONFIGURACAO.JS — textos das opções, prazos e etapas do fluxo.
   Primeiro script: só declara constantes, não executa nada.
   ========================================================================= */
'use strict';

// Não mudar sem migração: os dados reais ficam nesta chave do localStorage.
const CHAVE_ARMAZENAMENTO = 'devolucoes_v1';
// Marca gravada no backup JSON para reconhecer o arquivo na restauração.
const FORMATO_BACKUP = 'VATTEN_DEVOLUCOES_V1';
// Versão da estrutura do banco; subir só quando migrarBanco() precisar converter algo.
// v2: campos origem e ml (integração com o Mercado Livre).
const VERSAO_BANCO = 2;
// Configuração da ponte do Mercado Livre (endereço e chave). Fica fora do banco e do backup.
const CHAVE_CONFIG_ML = 'devolucoes_ml_config_v1';

const OPCOES = {
  status: {
    solicitada: 'Solicitada',
    aprovada: 'Aprovada',
    transito: 'Em trânsito',
    inspecao: 'Em inspeção',
    concluida: 'Concluída',
    recusada: 'Recusada',
    cancelada: 'Cancelada no ML',
  },
  origens: { manual: 'Manual', mercadolivre: 'Mercado Livre' },
  resultadosML: { ok: 'Chegou OK', falha: 'Chegou com problema' },
  // Reserva caso a ponte esteja fora do ar; a lista oficial vem de /motivos-falha.
  motivosML: {
    SRF2: 'O produto chegou danificado',
    SRF3: 'A devolução está incompleta',
    SRF4: 'Devolveram um produto diferente',
    SRF5: 'O produto não está no pacote',
    SRF6: 'Outra falha no produto',
    SRF7: 'Ainda não chegou',
  },
  situacoesRevisaoML: {
    nao_aplica: 'Não se aplica',
    pendente: 'A enviar',
    enviando: 'Enviando…',
    enviada: 'Enviada ao ML',
    erro: 'Erro no envio',
  },
  tipos: {
    arrependimento: 'Arrependimento',
    defeito: 'Defeito',
    troca: 'Troca (tamanho/cor)',
    erro_envio: 'Erro de envio',
  },
  canais: {
    loja: 'Loja própria',
    mercadolivre: 'Mercado Livre',
    shopee: 'Shopee',
    amazon: 'Amazon',
    fisica: 'Loja física',
  },
  motivos: {
    tamanho: 'Tamanho não serviu',
    nao_gostou: 'Não gostou',
    defeito: 'Produto com defeito',
    avariado: 'Chegou avariado',
    diferente: 'Diferente do anúncio',
    errado: 'Produto errado enviado',
    outro: 'Outro',
  },
  solucoes: { reembolso: 'Reembolso', troca: 'Troca', credito: 'Crédito na loja' },
  estados: { A: 'A · Como novo', B: 'B · Pequeno defeito', C: 'C · Sem condição de venda' },
  destinos: {
    estoque: 'Voltar ao estoque',
    outlet: 'Outlet / promoção',
    fornecedor: 'Devolver ao fornecedor',
    conserto: 'Conserto',
    descarte: 'Descarte',
  },
  // Confirme os CFOPs com o seu contador.
  cfops: {
    1202: '1.202 · Mesmo estado',
    2202: '2.202 · Outro estado',
    1411: '1.411 · Mesmo estado com ST',
    2411: '2.411 · Outro estado com ST',
  },
};

// Prazo em dias corridos a partir da entrega.
// Arrependimento: 7 dias (CDC art. 49). Defeito: 90 dias para bens duráveis (CDC art. 26).
// Troca e erro de envio: política da loja — ajuste aqui.
const PRAZO_DIAS = { arrependimento: 7, defeito: 90, troca: 30, erro_envio: 30 };
const PRAZO_PADRAO = 30;

// Ordem das etapas e o texto do botão que leva para a próxima.
const ETAPAS = ['solicitada', 'aprovada', 'transito', 'inspecao', 'concluida'];
const BOTAO_AVANCAR = {
  solicitada: 'Aprovar devolução',
  aprovada: 'Registrar envio (em trânsito)',
  transito: 'Confirmar recebimento',
};
const ABERTAS = ['solicitada', 'aprovada', 'transito', 'inspecao'];

/* ----------------------------- Mercado Livre ----------------------------- */

// Status do return no ML → etapa do sistema (docs/integracao-mercadolivre.md, seção 3.2).
const MAPA_STATUS_ML = {
  pending: 'aprovada',
  label_generated: 'aprovada',
  scheduled: 'aprovada',
  shipped: 'transito',
  pending_delivered: 'transito',
  delivered: 'inspecao',
  cancelled: 'cancelada',
  pending_cancel: 'cancelada',
  expired: 'cancelada',
  pending_expiration: 'cancelada',
  not_delivered: 'cancelada',
  return_to_buyer: 'cancelada',
  failed: 'cancelada',
  pending_failure: 'cancelada',
};
// Motivos de falha que exigem foto/arquivo de evidência.
const MOTIVOS_ML_COM_ANEXO = ['SRF2', 'SRF4'];
// Verificação automática enquanto o sistema está aberto (minutos).
const ML_INTERVALO_SINCRONIZACAO_MIN = 10;
// Primeira sincronização busca reclamações atualizadas nos últimos N dias.
const ML_DIAS_PRIMEIRA_SINCRONIZACAO = 60;
