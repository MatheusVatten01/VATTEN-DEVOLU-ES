# Integração com o Mercado Livre — o que estruturar

> **Situação (21/10/2026):** implementado. Ponte em `ponte/worker.js`, sistema em `src/js/mercadolivre.js`,
> instalação em `docs/ponte-passo-a-passo.md`. Falta validar com a conta real do ML.

Objetivo: **puxar automaticamente** as devoluções do Mercado Livre (ML) para o sistema e, quando a equipe preencher a
inspeção e clicar em **Concluir devolução**, **enviar a revisão para a conta do ML** na mesma hora.

Baseado na documentação oficial (consultada em 21/10/2026):
[Devoluções](https://developers.mercadolivre.com.br/pt_br/gerenciar-devolucoes) ·
[Reclamações](https://developers.mercadolivre.com.br/pt_br/gerenciar-reclamacoes) ·
[Autenticação](https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao).

---

## 1. O ponto principal: precisa de uma "ponte" fora do navegador

Hoje o sistema roda 100% no navegador, sem servidor. Para o ML isso **não basta sozinho**, por quatro motivos da própria API:

| Exigência do ML | Por que o HTML sozinho não atende |
|---|---|
| Trocar o código de autorização por token exige o **client_secret** do aplicativo | Qualquer pessoa com o arquivo HTML veria o segredo e poderia operar a conta do ML da Vatten |
| `redirect_uri` fixa, cadastrada no app, sem partes variáveis | Um arquivo aberto por duplo clique (`file://`) não tem endereço fixo para receber o retorno |
| `access_token` vence em **6 horas**; o `refresh_token` é **de uso único** | Se dois computadores renovarem ao mesmo tempo, um deles invalida o outro. O token precisa ficar num lugar só |
| Avisos de devolução nova chegam por **notificação** (tópicos `claims` e `claims_actions`) | O ML precisa de um endereço HTTPS público para avisar, e o navegador não tem um |

**Solução:** uma *ponte ML*, um serviço pequeno que guarda o segredo e os tokens, recebe as notificações e faz as
chamadas ao ML. O sistema no navegador conversa só com a ponte. Opções:

| Opção | Prós | Contras |
|---|---|---|
| **Cloudflare Worker + KV** (recomendado) | Gratuito para esse volume, HTTPS pronto, guarda token com segurança, rápido | Uma conta nova para administrar |
| **Google Apps Script** (Web App) | Usa a conta Google que a Vatten já tem, gratuito | Mais lento, CORS limitado, cotas diárias |
| Servidor próprio / VPS | Controle total | Custo e manutenção |

A ponte **não deve ser um proxy genérico**: expõe só as poucas ações abaixo e exige uma chave de acesso do sistema.
Como o HTML aberto por duplo clique envia `Origin: null`, a ponte precisa liberar CORS para isso.

### Endpoints da ponte (contrato sugerido)

| Ponte | O que faz no ML |
|---|---|
| `GET /devolucoes?desde=AAAA-MM-DD` | Busca reclamações com devolução e devolve tudo já combinado (reclamação + devolução + pedido + custo do frete) |
| `GET /devolucoes/{claimId}` | Atualiza uma devolução específica |
| `GET /motivos-falha?claimId=` | Lista os motivos de revisão com falha (SRF2…SRF7) |
| `POST /anexos/{claimId}` | Envia uma foto/PDF de evidência e devolve o `file_name` |
| `POST /revisao/{returnId}` | Envia a revisão (OK ou com falha) |
| `POST /notificacoes` | Endereço que o ML chama (cadastrado no app). Guarda a fila para o sistema puxar |
| `GET /autorizar` e `/retorno` | Autorização única (o administrador da conta ML clica uma vez) |

---

## 2. Chamadas ao ML que a ponte vai usar

| Etapa | Chamada | Uso |
|---|---|---|
| Descobrir devoluções | `GET /post-purchase/v1/claims/search?players.role=respondent&players.user_id={SELLER}&status=opened` | Lista reclamações contra a Vatten (exige pelo menos um filtro; paginação `offset/limit`) |
| Detalhe da reclamação | `GET /post-purchase/v1/claims/{claimId}` | `related_entities` contém `"return"` se houver devolução; `players[seller].available_actions` mostra se pode revisar e o `due_date` |
| Situação legível | `GET /post-purchase/v1/claims/{claimId}/detail` | Título, descrição, prazo (`due_date`) e quem deve agir |
| Dados da devolução | `GET /post-purchase/v2/claims/{claimId}/returns` | `id` (= return_id), `status`, `shipments` (rastreio, destino), `status_money`, `refund_at`, `orders` (item, quantidade) |
| Revisão da triagem (Full) | `GET /post-purchase/v1/returns/{returnId}/reviews` | Só quando `related_entities` da devolução tem `"reviews"` |
| Custo do frete reverso | `GET /post-purchase/v1/claims/{claimId}/charges/return-cost` | Preenche o campo **Frete reverso** |
| Motivos de falha | `GET /post-purchase/v1/returns/reasons?flow=seller_return_failed&claim_id={claimId}` | Lista SRF2…SRF7 para o select da inspeção |
| Evidências | `POST /post-purchase/v1/claims/{claimId}/returns/attachments` (multipart `file`) | Devolve `file_name` para anexar na revisão |
| **Revisar** | `POST /post-purchase/v1/returns/{returnId}/return-review` | Corpo `{}` = chegou OK. Corpo `[{"reason","message","attachments"}]` = chegou com problema |
| Dados do pedido | `GET /orders/{orderId}` | Produto, SKU, valor, data, comprador *(campos exatos a confirmar na doc de Orders)* |
| Data de entrega | `GET /shipments/{shipmentId}` | Data de entrega ao comprador para o prazo *(a confirmar na doc de Envios)* |

Regras da revisão, segundo a documentação:
- Só é possível revisar quando o vendedor tem `return_review_ok` / `return_review_fail` em `available_actions`.
- Com falha: `reason` e `message` são obrigatórios; **anexos obrigatórios para SRF2 (danificado) e SRF4 (produto diferente)**.
- Motivos com `apply: package` (ex.: SRF7, "ainda não chegou") valem para a devolução inteira.
- O ML devolve o dinheiro ao comprador **3 dias após o vendedor receber** (`refund_at: delivered`). Por isso a inspeção
  tem prazo curto e o sistema precisa alertar.
- Devoluções que vão para o **depósito do ML (Full)** passam pela triagem do ML: o vendedor não faz a revisão normal, só
  pode contestar. Essas devoluções aparecem no sistema **somente para consulta**.

---

## 3. O que estruturar no script do sistema

### 3.1 Modelo de dados (`dados.js` + `migrarBanco`, subir `VERSAO_BANCO` para 2)

Cada devolução ganha:

```js
origem: 'manual' | 'mercadolivre',
ml: {
  claimId, returnId, orderId, itemId, variationId, packId,
  statusDevolucao,      // status do return no ML (pending, shipped, delivered...)
  statusDinheiro,       // retained | refunded | available
  reembolsoEm,          // refund_at
  destino,              // seller_address | warehouse (warehouse = triagem do ML, só consulta)
  prazoRevisao,         // due_date da ação return_review_*
  podeRevisar,          // true se available_actions tem return_review_ok/fail
  sincronizadoEm,       // última atualização vinda do ML
  revisao: {
    situacao,           // 'nao_aplica' | 'pendente' | 'enviando' | 'enviada' | 'erro'
    tipo,               // 'ok' | 'falha'
    motivo,             // SRF2...SRF7 quando falha
    anexos: [],         // file_name devolvidos pelo ML
    tentativas, ultimoErro, enviadaEm,
  },
}
```

- Devoluções antigas recebem `origem: 'manual'` na migração.
- **Não duplicar**: ao importar, procurar por `ml.claimId`. Se já existir, só atualiza os campos vindos do ML e
  **nunca** sobrescreve o que a equipe preencheu (inspeção, parecer, NF-e, CFOP).

### 3.2 Correspondência de status do ML → etapas do sistema

| `status` do return no ML | Etapa no sistema |
|---|---|
| `pending`, `label_generated`, `scheduled` | Aprovada |
| `shipped`, `pending_delivered` | Em trânsito (rastreio vem de `shipments[].tracking_number`) |
| `delivered` | **Em inspeção** (abre o formulário de revisão) |
| `cancelled`, `expired`, `not_delivered`, `return_to_buyer`, `failed` | Encerrada. Sugestão: novo status **Cancelada no ML**, diferente de "Recusada" |

As etapas que vêm do ML são registradas no histórico com a nota "via Mercado Livre". O botão **Avançar** fica
escondido nas devoluções do ML, porque quem move essas etapas é o próprio ML.

### 3.3 Inspeção → revisão no ML (o fluxo que você descreveu)

1. A equipe preenche a inspeção. Para devoluções do ML aparecem dois campos novos:
   - **Resultado para o ML**: "Chegou OK" ou "Chegou com problema".
   - Se for problema: **Motivo ML** (select com SRF2…SRF7 vindo da ponte) e **Evidências** (fotos/PDF; obrigatórias para SRF2 e SRF4).
   - Sugestão automática: estado **A** → "Chegou OK"; estados **B/C** → "Chegou com problema".
   - O **Parecer** vira a `message` enviada ao ML.
2. Ao clicar **Concluir devolução**:
   1. valida localmente (motivo e anexos obrigatórios, prazo da revisão);
   2. **salva a conclusão no sistema primeiro**, com `revisao.situacao = 'pendente'`;
   3. envia as evidências (se houver) e depois a revisão pela ponte;
   4. em caso de sucesso: `situacao = 'enviada'` e histórico "Revisão enviada ao ML";
   5. em caso de erro (sem internet, token, prazo vencido): `situacao = 'erro'` com a mensagem, um aviso no painel e um botão **Reenviar ao ML** no detalhe.
3. Antes de enviar, a ponte confere `available_actions` de novo. Se a ação não existe mais (prazo vencido ou revisão
   já feita no site do ML), marca "Revisão não disponível" em vez de dar erro genérico.

Ponto importante: **concluir no sistema e revisar no ML são dois passos**. Se o envio falhar, a devolução fica concluída
aqui e a revisão fica pendente, visível, até ser reenviada. Assim nada se perde em silêncio.

### 3.4 Novo arquivo `js/mercadolivre.js` (depois de `dados.js`, antes das telas)

- `chamarPonte(caminho, opcoes)`: `fetch` com tempo limite, chave de acesso e mensagens de erro em português.
- `converterDevolucaoML(pacote)`: **função pura** que transforma o JSON da ponte em devolução do sistema (testável).
- `importarDevolucoesML()`: botão **Sincronizar ML** e verificação automática a cada X minutos com o sistema aberto.
- `montarRevisaoML(d)`: monta o corpo `{}` ou `[{reason, message, attachments}]` (função pura, testável).
- `enviarRevisaoML(d)` e `reenviarPendentes()`.

### 3.5 Configuração (`configuracao.js`)

- `ML_PONTE_URL` e a chave de acesso, informadas numa tela **Configurações**. A chave não vai no código nem no backup.
- `MAPA_STATUS_ML` (tabela da seção 3.2) e o rótulo dos motivos SRF como reserva caso a ponte esteja fora do ar.
- Canal `mercadolivre` já existe em `OPCOES.canais`.

### 3.6 Telas

- **Barra superior**: botão "Sincronizar ML" com a hora da última sincronização.
- **Lista**: selo "ML" na linha e filtro de origem (Manual / Mercado Livre).
- **Painel**: "Revisões a enviar ao ML" e "Prazo de revisão vencendo" (o dinheiro sai 3 dias após o recebimento).
- **Detalhe**: bloco "Mercado Livre" com nº da reclamação e da devolução, status no ML, dinheiro, prazo de revisão,
  situação do envio da revisão e link para abrir a reclamação no ML.

### 3.7 Testes (`testes/testes.js`)

Usar como amostra os JSONs de exemplo da própria documentação do ML:
- conversão claim + return + pedido → devolução;
- correspondência de status (seção 3.2);
- importar duas vezes não duplica nem apaga a inspeção preenchida;
- corpo da revisão: OK = `{}`, falha com SRF2 sem anexo = erro;
- falha no envio deixa `situacao = 'erro'` e a devolução concluída;
- devoluções com destino `warehouse` não mostram o formulário de revisão.

### 3.8 Armazenamento e LGPD

- Fotos de evidência **não** vão para o localStorage (limite de cerca de 5 MB): são enviadas direto para a ponte e só o
  `file_name` fica salvo.
- Dados do comprador vindos do ML entram no backup como os demais: mesma regra da LGPD (não publicar, não enviar a terceiros).
- A ponte guarda **somente** tokens e a fila de notificações, sem cópia dos dados dos clientes.

---

## 4. O que a Vatten precisa providenciar

1. Acesso de administrador à conta de vendedor do ML (para autorizar o aplicativo uma vez).
2. Criar o aplicativo em *developers.mercadolivre.com.br → Minhas aplicações*: anotar **App ID** e **Secret Key**,
   cadastrar a **Redirect URI** (endereço da ponte), habilitar os escopos de leitura, escrita e `offline_access` e, em
   *Notificações → Post Purchase*, marcar **claims** e **claims_actions**.
3. Escolher onde a ponte roda (seção 1).
4. Uma devolução real ou um usuário de teste do ML para validar antes de ligar em produção.

## 5. Decisões em aberto

- Onde hospedar a ponte (Cloudflare, Apps Script ou servidor próprio).
- Se devoluções do ML com status cancelado/expirado entram como "Cancelada no ML" (novo status) ou "Recusada".
- Se a sincronização é só por botão ou também automática com o sistema aberto.
- Se trocas do ML (reclamação tipo `change`) entram no mesmo fluxo. A [doc de Trocas](https://developers.mercadolivre.com.br/pt_br/trocas) ainda não foi analisada.

## 6. Ordem sugerida de implementação

1. Modelo de dados + migração + `converterDevolucaoML` + testes com os JSONs da documentação (dá para fazer já, sem a ponte).
2. Telas: selo ML, bloco ML no detalhe, campos de revisão na inspeção, situação da revisão.
3. Ponte: autorização, `GET /devolucoes`, `POST /revisao`, anexos.
4. Notificações e sincronização automática.
5. Teste com uma devolução real e depois uso em produção.
