/* =========================================================================
   PONTE ML — Cloudflare Worker entre o sistema Vatten Devoluções e a API do
   Mercado Livre. Guarda o client_secret e os tokens (fora do navegador),
   recebe as notificações do ML e expõe só as ações que o sistema usa.

   Como publicar: veja docs/ponte-passo-a-passo.md (cola-se este arquivo no
   editor do painel da Cloudflare; não precisa instalar nada).

   Configuração no Worker (Settings → Variables and Secrets / Bindings):
     ML_APP_ID        texto   App ID do aplicativo no Mercado Livre
     ML_REDIRECT_URI  texto   https://<seu-worker>.workers.dev/retorno (igual ao cadastrado no ML)
     ML_SECRET        secreto Secret Key do aplicativo
     PONTE_CHAVE      secreto chave longa e aleatória; a mesma vai na tela Configurações do sistema
     ML_SELLER_ID     texto   (opcional) user_id da conta Vatten no ML; recusa autorizar outra conta
     PONTE            KV      namespace onde ficam tokens e a fila de notificações

   Rotas para o sistema (todas exigem o cabeçalho X-Chave-Ponte):
     GET  /status                      autorizado? qual conta? token vence quando?
     GET  /devolucoes?desde=AAAA-MM-DD lista leve: [{ claimId, atualizadoEm }]
     GET  /devolucoes/{claimId}        pacote completo de uma devolução
     GET  /motivos-falha?claimId=      motivos SRF da revisão com falha
     POST /anexos/{claimId}            corpo = bytes do arquivo; cabeçalho X-Nome-Arquivo
     POST /revisao/{returnId}?claimId= corpo = {} (OK) ou [{reason, message, attachments}]
   Rotas públicas:
     GET  /autorizar?chave=PONTE_CHAVE inicia a autorização (o administrador da conta ML faz uma vez)
     GET  /retorno                     o ML volta aqui com o code
     POST /notificacoes                o ML avisa aqui (tópicos claims e claims_actions)

   Limite do plano gratuito: 50 chamadas externas por requisição. Por isso a
   lista é leve e o pacote completo é pedido uma devolução por vez.
   ========================================================================= */

const API = 'https://api.mercadolibre.com';
const AUTH = 'https://auth.mercadolivre.com.br/authorization';
const MAX_PAGINAS_BUSCA = 8;
const POR_PAGINA = 50;
const MAX_FILA = 300;

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    try {
      return await rotear(req, env);
    } catch (e) {
      const status = e.status || 500;
      return json({ erro: e.message || String(e), detalhe: e.detalhe ?? null }, status);
    }
  },
};

/* ----------------------------- Rotas ----------------------------- */

async function rotear(req, env) {
  const url = new URL(req.url);
  const partes = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  const [rota, id] = partes;
  const metodo = req.method;

  // Públicas
  if (rota === 'autorizar' && metodo === 'GET') return autorizar(url, env);
  if (rota === 'retorno' && metodo === 'GET') return retorno(url, env);
  if (rota === 'notificacoes' && metodo === 'POST') return receberNotificacao(req, env);

  // Do sistema
  exigirChave(req, env);
  if (rota === 'status' && metodo === 'GET') return json(await status(env));
  if (rota === 'devolucoes' && metodo === 'GET' && !id) return json(await listarDevolucoes(url, env));
  if (rota === 'devolucoes' && metodo === 'GET' && id) return json(await pacoteDevolucao(numero(id), env));
  if (rota === 'motivos-falha' && metodo === 'GET') return json(await motivosFalha(url, env));
  if (rota === 'anexos' && metodo === 'POST' && id) return json(await enviarAnexo(numero(id), req, env));
  if (rota === 'revisao' && metodo === 'POST' && id) return json(await enviarRevisao(numero(id), url, req, env));
  throw erro(404, 'Rota não encontrada na ponte.');
}

function exigirChave(req, env) {
  if (!env.PONTE_CHAVE || req.headers.get('X-Chave-Ponte') !== env.PONTE_CHAVE)
    throw erro(401, 'Chave da ponte inválida. Confira a chave na tela Configurações do sistema.');
}

/* ------------------------- Autorização OAuth ------------------------- */

async function autorizar(url, env) {
  if (url.searchParams.get('chave') !== env.PONTE_CHAVE) return pagina('Chave inválida.', 401);
  const estado = crypto.randomUUID();
  await env.PONTE.put(`estado:${estado}`, '1', { expirationTtl: 600 });
  const destino = new URL(AUTH);
  destino.searchParams.set('response_type', 'code');
  destino.searchParams.set('client_id', env.ML_APP_ID);
  destino.searchParams.set('redirect_uri', env.ML_REDIRECT_URI);
  destino.searchParams.set('state', estado);
  return Response.redirect(destino.toString(), 302);
}

async function retorno(url, env) {
  const code = url.searchParams.get('code');
  const estado = url.searchParams.get('state');
  if (!code || !estado || !(await env.PONTE.get(`estado:${estado}`)))
    return pagina('Autorização inválida ou expirada. Abra /autorizar de novo.', 400);
  await env.PONTE.delete(`estado:${estado}`);
  const token = await pedirToken(env, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: env.ML_REDIRECT_URI,
  });
  if (env.ML_SELLER_ID && String(token.user_id) !== String(env.ML_SELLER_ID))
    return pagina(`Esta conta (${token.user_id}) não é a conta Vatten configurada. Nada foi salvo.`, 403);
  await salvarToken(env, token);
  return pagina(`Mercado Livre autorizado para a conta ${token.user_id}. Pode fechar esta página.`);
}

async function pedirToken(env, campos) {
  const corpo = new URLSearchParams({ client_id: env.ML_APP_ID, client_secret: env.ML_SECRET, ...campos });
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: corpo,
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw erro(502, `O Mercado Livre recusou o token (${dados.error || r.status}).`, dados);
  return dados;
}

async function salvarToken(env, t) {
  await env.PONTE.put(
    'tokens',
    JSON.stringify({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      user_id: t.user_id,
      expira_em: Date.now() + (Number(t.expires_in) || 21600) * 1000,
    }),
  );
}

/** Token válido; renova 5 minutos antes de vencer. O refresh_token do ML é de uso único. */
async function tokenValido(env) {
  const t = await env.PONTE.get('tokens', { type: 'json' });
  if (!t) throw erro(409, 'A ponte ainda não foi autorizada no Mercado Livre. Abra /autorizar.');
  if (Date.now() < t.expira_em - 5 * 60 * 1000) return t;
  const novo = await pedirToken(env, { grant_type: 'refresh_token', refresh_token: t.refresh_token });
  await salvarToken(env, novo);
  return { ...novo, expira_em: Date.now() + (Number(novo.expires_in) || 21600) * 1000 };
}

async function status(env) {
  const t = await env.PONTE.get('tokens', { type: 'json' });
  return { autorizado: !!t, contaML: t?.user_id ?? null, tokenVenceEm: t ? new Date(t.expira_em).toISOString() : null };
}

/* ---------------------------- Chamadas ML ---------------------------- */

async function ml(env, caminho, opcoes = {}) {
  const t = await tokenValido(env);
  const r = await fetch(API + caminho, {
    ...opcoes,
    headers: { Authorization: `Bearer ${t.access_token}`, accept: 'application/json', ...(opcoes.headers || {}) },
  });
  const texto = await r.text();
  let dados = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    dados = texto;
  }
  if (!r.ok) throw erro(r.status, `Mercado Livre: ${dados?.message || dados?.error || r.status}`, dados);
  return dados;
}

/** Como ml(), mas devolve null em vez de falhar (para dados opcionais do pacote). */
async function mlOpcional(env, caminho) {
  try {
    return await ml(env, caminho);
  } catch {
    return null;
  }
}

/* --------------------------- Devoluções --------------------------- */

/** Lista leve: reclamações contra a Vatten que têm devolução, mais as avisadas por notificação. */
async function listarDevolucoes(url, env) {
  const t = await tokenValido(env);
  const desde = url.searchParams.get('desde') || '';
  const encontradas = new Map();

  for (let pagina = 0; pagina < MAX_PAGINAS_BUSCA; pagina++) {
    const q = new URLSearchParams({
      'players.role': 'respondent',
      'players.user_id': String(t.user_id),
      offset: String(pagina * POR_PAGINA),
      limit: String(POR_PAGINA),
    });
    const r = await ml(env, `/post-purchase/v1/claims/search?${q}`);
    const lista = r?.data || r?.results || [];
    for (const c of lista) {
      const temDevolucao = (c.related_entities || []).includes('return') || c.type === 'return';
      if (!temDevolucao) continue;
      if (desde && String(c.last_updated || c.date_created || '').slice(0, 10) < desde) continue;
      encontradas.set(String(c.id), { claimId: c.id, atualizadoEm: c.last_updated || c.date_created || null });
    }
    const total = r?.paging?.total ?? 0;
    if (lista.length < POR_PAGINA || (pagina + 1) * POR_PAGINA >= total) break;
  }

  // Reclamações avisadas pelo ML desde a última sincronização
  const fila = (await env.PONTE.get('fila', { type: 'json' })) || [];
  for (const claimId of fila)
    if (!encontradas.has(String(claimId))) encontradas.set(String(claimId), { claimId, atualizadoEm: null });
  await env.PONTE.put('fila', '[]');

  return { devolucoes: [...encontradas.values()] };
}

/** Tudo o que o sistema precisa de uma devolução, numa resposta só. */
async function pacoteDevolucao(claimId, env) {
  const claim = await ml(env, `/post-purchase/v1/claims/${claimId}`);
  const devolucao = await ml(env, `/post-purchase/v2/claims/${claimId}/returns`);
  const detalhe = await mlOpcional(env, `/post-purchase/v1/claims/${claimId}/detail`);
  const custo = await mlOpcional(env, `/post-purchase/v1/claims/${claimId}/charges/return-cost`);
  const orderId = devolucao?.orders?.[0]?.order_id || (claim.resource === 'order' ? claim.resource_id : null);
  const pedido = orderId ? await mlOpcional(env, `/orders/${orderId}`) : null;
  const envio = pedido?.shipping?.id ? await mlOpcional(env, `/shipments/${pedido.shipping.id}`) : null;
  const revisoes = (devolucao?.related_entities || []).includes('reviews')
    ? await mlOpcional(env, `/post-purchase/v1/returns/${devolucao.id}/reviews`)
    : null;
  return { claim, devolucao, detalhe, custo, pedido, envio, revisoes };
}

async function motivosFalha(url, env) {
  const claimId = numero(url.searchParams.get('claimId'));
  const motivos = await ml(env, `/post-purchase/v1/returns/reasons?flow=seller_return_failed&claim_id=${claimId}`);
  return { motivos };
}

async function enviarAnexo(claimId, req, env) {
  const nome = req.headers.get('X-Nome-Arquivo') || 'evidencia';
  const tipo = req.headers.get('Content-Type') || 'application/octet-stream';
  const form = new FormData();
  form.append('file', new Blob([await req.arrayBuffer()], { type: tipo }), nome);
  const r = await ml(env, `/post-purchase/v1/claims/${claimId}/returns/attachments`, { method: 'POST', body: form });
  return { fileName: r.file_name };
}

/** Confere se a revisão ainda está disponível para o vendedor e envia. */
async function enviarRevisao(returnId, url, req, env) {
  const claimId = numero(url.searchParams.get('claimId'));
  const corpo = await req.json();
  const acao = Array.isArray(corpo) ? 'return_review_fail' : 'return_review_ok';
  const claim = await ml(env, `/post-purchase/v1/claims/${claimId}`);
  const vendedor = (claim.players || []).find((p) => p.type === 'seller');
  const acoes = (vendedor?.available_actions || []).map((a) => a.action);
  if (!acoes.includes(acao) && !acoes.includes('return_review'))
    throw erro(409, 'Revisão não disponível no Mercado Livre (prazo vencido ou já revisada no site).', { acoes });
  const r = await ml(env, `/post-purchase/v1/returns/${returnId}/return-review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  return { ok: true, resposta: r };
}

/* -------------------------- Notificações -------------------------- */

/** O ML exige resposta rápida (200). Guarda só o número da reclamação na fila. */
async function receberNotificacao(req, env) {
  const n = await req.json().catch(() => null);
  if (n && String(n.application_id) === String(env.ML_APP_ID)) {
    const claimId = String(n.resource || '').match(/claims\/(\d+)/)?.[1];
    if (claimId) {
      const fila = (await env.PONTE.get('fila', { type: 'json' })) || [];
      if (!fila.includes(claimId)) fila.push(claimId);
      await env.PONTE.put('fila', JSON.stringify(fila.slice(-MAX_FILA)));
    }
  }
  return new Response('ok', { status: 200 });
}

/* --------------------------- Utilitários --------------------------- */

function cors() {
  // O sistema aberto por duplo clique envia Origin "null"; a proteção é a X-Chave-Ponte.
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Chave-Ponte, X-Nome-Arquivo',
    'Access-Control-Max-Age': '86400',
  };
}

function json(dados, status = 200) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors() },
  });
}

function pagina(mensagem, status = 200) {
  const seguro = String(mensagem).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Ponte ML</title><body style="font:16px Segoe UI,sans-serif;padding:40px"><p>${seguro}</p>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function numero(v) {
  if (!/^\d+$/.test(String(v || ''))) throw erro(400, 'Identificador inválido.');
  return String(v);
}

function erro(status, mensagem, detalhe) {
  const e = new Error(mensagem);
  e.status = status;
  e.detalhe = detalhe;
  return e;
}
