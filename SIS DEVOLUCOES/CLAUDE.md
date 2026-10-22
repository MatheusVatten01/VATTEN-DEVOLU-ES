# Vatten Devoluções — guia do projeto

Sistema interno da Vatten para controlar **trocas e devoluções de clientes**. Roda **100% no navegador**, sem
servidor nem banco central (mesmo modelo do Vatten PLR, em `Desktop\SIS PLR - RH`). Nasceu de um esboço feito em
outro chat (guardado em `esboco-original/`, somente referência) e foi reorganizado no padrão do projeto PLR.

## Estrutura

```
src/                     <- CÓDIGO-FONTE OFICIAL (editar só aqui)
  index.html             barra superior com abas + 4 telas + ordem dos <link>/<script>
  css/01-base.css        variáveis (cores/medidas), base e layout (barra superior, página centralizada, celular)
  css/02-componentes.css bloco, número, funil, tabela, status, formulário, botão, menu Dados, resumo, linha do tempo
  css/03-estados.css     classes ligadas pelo JS (.tela--ativa, .oculto, toast)
  js/configuracao.js     OPCOES (status, tipos, canais, motivos, CFOPs...), PRAZO_DIAS, ETAPAS, chaves
  js/utilitarios.js      $, hojeISO, somarDias, diasEntre, dataBR, reais, esc, toast, baixarArquivo
  js/dados.js            banco (localStorage), migrarBanco, regras do fluxo (avancar, concluir, recusar...)
  js/mercadolivre.js     integração ML pela ponte: converterDevolucaoML, aplicarPacoteML, montarRevisaoML,
                         sincronizarML (ao abrir + a cada 10 min), enviarRevisaoML, chamarPonte
  js/navegacao.js        navegar() pelo hash: #painel, #lista, #nova, #detalhe/DV-0001, #config
  js/painel.js, js/lista.js, js/nova.js, js/detalhe.js   uma tela cada
  js/configuracoes.js    tela #config (endereço e chave da ponte ML)
  js/backup.js           backup JSON, restauração e CSV
  js/inicializacao.js    liga botões e chama iniciar() (SEMPRE o último script)
testes/                  testes automáticos (abrem src/ num iframe)
ferramentas/servidor.ps1 servidor local na porta 8001 (PowerShell, sem Python/Node)
ferramentas/build.ps1    gera dist/Vatten_Devolucoes.html (arquivo único, uso diário)
ferramentas/formatar.html formata src/ com Prettier (via servidor local)
dist/                    saída do build — não editar à mão
esboco-original/         app.js/estilo.css/index.html do primeiro esboço — não editar
docs/integracao-mercadolivre.md  plano da integração com a API do Mercado Livre (ponte, modelo, fluxo da revisão)
docs/ponte-passo-a-passo.md      instalação da ponte (Cloudflare + app no ML) e uso no dia a dia
ponte/worker.js          Cloudflare Worker "ponte ML" (ES module; colado no painel da Cloudflare, não vai no build)
```

**Visual próprio** (de propósito, diferente do PLR e dos outros sistemas Vatten): barra superior verde-petróleo com
abas (sem menu lateral), fundo areia, acento laranja, títulos em Bahnschrift, menu "Dados" (CSV/backup) num
`<details>`. Painel com funil de etapas clicável; Nova devolução com resumo de prazo fixo ao lado; Detalhe com linha do
tempo horizontal e painel de ações à direita. Cores só em `:root` de `01-base.css`.

## Fluxo de trabalho

1. Editar arquivos em `src/`.
2. Servidor: `powershell -ExecutionPolicy Bypass -File ferramentas\servidor.ps1` (ou tarefa do VS Code).
3. Testar em `http://localhost:8001/src/` e rodar `http://localhost:8001/testes/` — todos os testes devem passar.
4. Gerar o arquivo final: `powershell -ExecutionPolicy Bypass -File ferramentas\build.ps1` → `dist\Vatten_Devolucoes.html`.
5. Ao mudar regra (prazo, etapa, validação), adicionar/ajustar teste em `testes/testes.js`.

Ambiente: Windows, PowerShell 5.1, VS Code. **Não há Python, Node nem Git instalados.** Scripts `.ps1` devem ser
ASCII puro (o PowerShell 5.1 lê arquivo sem BOM como ANSI e estraga acentos). Porta 8001 para rodar junto com o PLR (8000).

## Regras importantes do código

- Scripts **clássicos** que compartilham o escopo global (`banco`, `$`, `salvar()`…). Não usar `type="module"`,
  `async` ou `defer` nos scripts. Ordem em `index.html`: `configuracao` → `utilitarios` → `dados` → `navegacao` e
  telas → `inicializacao`. Só `inicializacao.js` executa algo no carregamento.
- Regras de negócio ficam em `dados.js` e **não tocam na tela**: lançam `Error` com a mensagem para o usuário; as
  telas (`detalhe.js` → `acaoNaAberta`) mostram o erro. Isso permite testar sem DOM.
- **Datas de "hoje"**: usar `hojeISO()`. Nunca `new Date().toISOString()` para data — é UTC e vira o dia seguinte
  após 21h. `toISOString()` só é usado no carimbo de data/hora do histórico (`historico[].em`), exibido com `dataHoraBR`.
- **Não mudar a chave** `CHAVE_ARMAZENAMENTO = 'devolucoes_v1'` nem o formato do backup
  (`formato: 'VATTEN_DEVOLUCOES_V1'`) sem migração. Mudança de estrutura: tratar em `migrarBanco()` e subir `VERSAO_BANCO`.
- Se os dados salvos não puderem ser lidos, `erroCarregamento` bloqueia `salvar()` até restaurar um backup — nunca
  remover essa trava (evita gravar banco vazio por cima dos dados reais).
- Escapar todo texto do usuário com `esc()` ao montar HTML.
- Dados do navegador dependem do endereço: `file://` (duplo clique) e `http://localhost:8001` são bancos separados.
  Antes de trocar o arquivo em uso, fazer **Backup** e restaurar na nova versão.
- O build falha se sobrar `<script src="http...">` externo: o sistema deve funcionar sem internet.

## LGPD

As devoluções guardam nome, CPF e contato de clientes. Backups (`backup-devolucoes-*.json`) e planilhas
(`devolucoes-*.csv`) contêm dados pessoais: nunca publicar em repositório público nem enviar para serviços externos.

## Regras de negócio atuais

- Etapas: Solicitada → Aprovada → Em trânsito (exige código de rastreio) → Em inspeção → Concluída. Recusa possível
  em qualquer etapa aberta, com motivo obrigatório. Códigos sequenciais `DV-0001`.
- Prazo do cliente = data de entrega + `PRAZO_DIAS[tipo]`: arrependimento 7 (CDC art. 49), defeito 90 (CDC art. 26),
  troca 30 e erro de envio 30 (política da loja). Registrar fora do prazo é permitido, com aviso.
- Painel: devoluções por mês de abertura, em aberto (alerta com prazo ≤ 1 dia), % concluídas que viraram
  troca/crédito, custo de frete reverso.
- **Mercado Livre** (implementado; falta validar com conta real):
  - O sistema só fala com a ponte (`ponte/worker.js`, Cloudflare Worker + KV), que guarda client_secret/tokens e recebe
    notificações. **Nunca** colocar App Secret ou token no HTML. Endereço/chave da ponte ficam em
    `CHAVE_CONFIG_ML` (localStorage), fora do banco e do backup.
  - Devolução do ML: `origem: 'mercadolivre'` + bloco `ml` (claimId, returnId, status, triagem, prazoRevisao,
    `revisao.situacao`). Deduplicação por `ml.claimId`; reimportar nunca apaga o que a equipe preencheu.
  - Etapas vêm do ML (`MAPA_STATUS_ML`), só para frente; botão Avançar escondido. Novo status `cancelada`.
  - Concluir inspeção → salva local com `revisao.situacao='pendente'` → envia (anexos antes) → `enviada` ou `erro`
    (botão Reenviar). SRF2/SRF4 exigem anexo. Destino `warehouse` = triagem do ML, sem revisão do vendedor.
  - Testes não chamam a ponte: `isolado()` substitui `chamarPonte`, `configML` e `salvarConfigML`.
  - Plano free da Cloudflare: 50 chamadas externas por requisição. Por isso a ponte tem lista leve + pacote por devolução.
- **A confirmar com a Vatten** (vieram do esboço genérico): canais de venda, motivos, prazos de troca/erro de envio,
  CFOPs (confirmar com o contador) e se o alerta de prazo deve valer depois que a devolução já foi solicitada.
