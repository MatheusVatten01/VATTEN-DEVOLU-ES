/* =========================================================================
   CONFIGURACOES.JS — tela de configuração da ponte do Mercado Livre.
   Endereço e chave ficam só neste navegador (CHAVE_CONFIG_ML), fora do backup.
   ========================================================================= */
'use strict';

function renderConfig() {
  const cfg = configML();
  $('cfgUrl').value = cfg.url || '';
  $('cfgChave').value = cfg.chave || '';
  $('cfgUltima').textContent = cfg.ultimaSincronizacao
    ? `Última sincronização: ${dataHoraBR(cfg.ultimaSincronizacao)}`
    : 'Ainda não sincronizado.';
  $('cfgResultado').textContent = '';
  $('cfgResultado').className = 'aviso oculto';
}

/** Grava o que está na tela. Retorna false se o endereço for inválido. */
function gravarConfigTela() {
  const url = $('cfgUrl').value.trim().replace(/\/+$/, '');
  const chave = $('cfgChave').value.trim();
  if (url && !/^https:\/\//i.test(url)) {
    alert('O endereço da ponte precisa começar com https://');
    return false;
  }
  salvarConfigML({ ...configML(), url, chave });
  atualizarBotaoML();
  return true;
}

function salvarConfigTela(evento) {
  evento.preventDefault();
  if (!gravarConfigTela()) return;
  toast(mlConfigurado() ? 'Configuração do Mercado Livre salva.' : 'Integração com o Mercado Livre desligada.');
}

async function testarPonte() {
  if (!gravarConfigTela()) return;
  const resultado = $('cfgResultado');
  resultado.className = 'aviso';
  resultado.textContent = 'Testando…';
  try {
    const s = await chamarPonte('/status', { tempoLimite: 15000 });
    resultado.textContent = s.autorizado
      ? `Conectado. Conta do Mercado Livre: ${s.contaML}. Token renova sozinho (próximo vencimento ${dataHoraBR(s.tokenVenceEm)}).`
      : 'A ponte respondeu, mas ainda não foi autorizada no Mercado Livre. Abra o endereço /autorizar da ponte (veja o passo a passo).';
    if (!s.autorizado) resultado.className = 'aviso aviso--alerta';
  } catch (erro) {
    resultado.className = 'aviso aviso--alerta';
    resultado.textContent = erro.message;
  }
}
