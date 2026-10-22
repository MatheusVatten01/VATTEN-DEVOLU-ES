# Ponte do Mercado Livre — passo a passo de instalação

Tudo pelo navegador: não precisa instalar nada no computador. Tempo estimado: 30 minutos.
Ao final, o sistema busca as devoluções do Mercado Livre sozinho e envia a revisão quando você concluir a inspeção.

```
Sistema (HTML no computador)  →  Ponte (Cloudflare)  →  Mercado Livre
       endereço + chave            App ID, Secret, tokens
```

---

## Parte 1 — Criar a ponte na Cloudflare

1. Crie uma conta gratuita em **dash.cloudflare.com** (use um e-mail da empresa).
2. No menu, abra **Workers & Pages → Create → Create Worker** (modelo "Hello World").
   - Nome: `vatten-ml` → **Deploy**.
   - Anote o endereço que aparece, algo como `https://vatten-ml.SUACONTA.workers.dev`. Ele é o **endereço da ponte**.
3. Clique em **Edit code**, apague o conteúdo do editor, cole **todo** o arquivo `ponte/worker.js` deste projeto e clique em **Deploy**.
4. Crie o armazenamento: menu **Storage & Databases → Workers KV → Create**. Nome: `vatten-ml-dados`.
5. Ligue o armazenamento à ponte: abra o Worker `vatten-ml` → **Settings → Bindings → Add → KV namespace**.
   - Variable name: `PONTE` (exatamente assim)
   - KV namespace: `vatten-ml-dados`

## Parte 2 — Criar o aplicativo no Mercado Livre

Entre com a **conta de vendedor da Vatten** (ou um usuário administrador dela) em
**developers.mercadolivre.com.br → Minhas aplicações → Criar aplicação**:

| Campo | O que colocar |
|---|---|
| Nome / descrição | Vatten Devoluções (uso interno) |
| **URI de redirect** | `https://vatten-ml.SUACONTA.workers.dev/retorno` |
| PKCE | **Deixe desligado.** A ponte usa o segredo e o `state`; com PKCE ligado a autorização falha |
| Escopos / permissões | Leitura, escrita e acesso offline (`offline_access`). Na seção de permissões funcionais, marque **pós-venda / reclamações** |
| **URL de notificações** | `https://vatten-ml.SUACONTA.workers.dev/notificacoes` |
| Tópicos | Em **Post Purchase**, marque `claims` e `claims_actions` |
| IPs permitidos | Deixe sem restrição (a Cloudflare usa vários IPs) |

Salve e anote o **App ID** (número) e a **Secret Key**.

## Parte 3 — Colocar as credenciais na ponte

1. Gere a chave da ponte. No PowerShell do computador, rode o comando abaixo e copie o resultado:

```powershell
[guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
```

2. No Worker `vatten-ml` → **Settings → Variables and Secrets → Add**, crie:

| Nome | Tipo | Valor |
|---|---|---|
| `ML_APP_ID` | Text | App ID do Mercado Livre |
| `ML_REDIRECT_URI` | Text | `https://vatten-ml.SUACONTA.workers.dev/retorno` (igual ao cadastrado no ML) |
| `ML_SECRET` | **Secret** | Secret Key do Mercado Livre |
| `PONTE_CHAVE` | **Secret** | a chave gerada no passo 1 |

3. Clique em **Deploy** para aplicar.

> A Secret Key e a chave da ponte **não devem** ir para e-mail, WhatsApp ou planilha. Guarde no gerenciador de senhas da empresa.

## Parte 4 — Autorizar a conta (uma vez)

1. Logado no Mercado Livre com a conta da Vatten, abra no navegador:
   `https://vatten-ml.SUACONTA.workers.dev/autorizar?chave=SUA_PONTE_CHAVE`
2. Aceite as permissões. A página deve mostrar **"Mercado Livre autorizado para a conta NNNN"**.
3. *(Recomendado)* Crie a variável `ML_SELLER_ID` (Text) com esse número NNNN e faça Deploy. Assim a ponte recusa
   autorizar qualquer outra conta por engano.

A partir daqui a ponte renova o acesso sozinha. Só é preciso autorizar de novo se alguém trocar a senha da conta ML,
gerar uma nova Secret Key, revogar o aplicativo ou se a ponte ficar 4 meses sem uso.

## Parte 5 — Ligar no sistema

1. Abra o sistema → menu **Dados ▾ → Mercado Livre (configurar)…**
2. Preencha o **Endereço da ponte** e a **Chave da ponte** → **Salvar e testar conexão**.
   - Deve aparecer: "Conectado. Conta do Mercado Livre: NNNN".
3. Clique em **Sincronizar agora**. As devoluções dos últimos 60 dias entram com o selo **ML**.

Faça isso **em cada computador** que for usar o sistema: o endereço e a chave ficam só naquele navegador e não vão
no backup.

---

## Como usar no dia a dia

- O sistema sincroniza ao abrir e a cada 10 minutos. O botão amarelo **Sincronizar ML** força na hora; passe o mouse
  sobre ele para ver a última sincronização ou o último erro.
- As etapas das devoluções do ML (aprovada, em trânsito, recebida) são atualizadas **pelo próprio ML**.
- Quando chega, a devolução vai para **Em inspeção**. Preencha a inspeção e, no quadro amarelo **Revisão no Mercado Livre**:
  - **Chegou OK**: só concluir.
  - **Chegou com problema**: escolha o motivo e escreva o parecer (ele vai como mensagem). Para *danificado* e
    *produto diferente*, anexe fotos (obrigatório pelo ML).
- Ao clicar **Concluir devolução**, a conclusão é salva e a revisão é enviada. Se der erro, a devolução mostra
  **Erro no envio** e um botão **Reenviar revisão ao ML**. O painel também avisa.
- **Prazo:** o ML devolve o dinheiro ao comprador 3 dias após a devolução chegar. Revise logo.
- Devoluções que foram para o **depósito do ML** são revisadas pela triagem do ML: no sistema elas ficam só para registro.

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| "Chave da ponte inválida" | A chave no sistema é diferente de `PONTE_CHAVE` na Cloudflare |
| "A ponte ainda não foi autorizada" | Faça a Parte 4 |
| "O Mercado Livre recusou o token (invalid_grant)" | A autorização caiu (senha trocada, app revogado). Faça a Parte 4 de novo |
| "Sem conexão com a ponte" | Sem internet ou endereço errado (precisa começar com `https://`) |
| "Revisão não disponível no Mercado Livre" | O prazo venceu ou alguém revisou pelo site do ML. Confira no ML |
| Erro 403 do Mercado Livre | Permissões do app incompletas: confira escopos e permissões de pós-venda (Parte 2) |

## O que ainda precisa ser validado com uma devolução real

A documentação do ML não detalha alguns pontos, então eles foram feitos com a melhor informação disponível:
- formato exato da resposta da busca de reclamações (`/post-purchase/v1/claims/search`);
- campos de nome do comprador e data de entrega (vêm de `/orders` e `/shipments`; se faltarem, o sistema usa o apelido
  ML e a data da reclamação);
- confirmar que uma revisão enviada pelo sistema aparece no painel de vendas do ML.

Na primeira devolução real, acompanhe pelo site do ML e reporte qualquer diferença.
