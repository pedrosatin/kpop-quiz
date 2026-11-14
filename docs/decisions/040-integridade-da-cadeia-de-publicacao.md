# ADR 040 sobre a integridade da cadeia de publicação

## Status

Aprovado em 2026-11-14. Muda os seis workflows de `.github/workflows/`, acrescenta `kpop_scraping/workflow_commands.py` e a opção `--verify` de `python -m kpop_scraping.map_pilot_refresh` e põe o `wrangler` entre as devDependencies de `web/`. A geração dos jogos, o conteúdo dos artefatos, as permissões dos workflows, o ruleset da `master` e o self-merge do [ADR 031](031-self-merge-so-do-commit-enviado.md) continuam como estavam.

## Contexto

O job `daily-puzzles` do `daily-puzzles-cron` gera o conjunto do dia, verifica os arquivos com `npm run artifacts:verify` e envia o diretório como artefato. O job `publish` baixa o artefato num checkout da `master`, faz o commit e o merge pelo `scripts/publish_via_pr.py`. Quando o workflow termina, o `pages.yml` verifica a `master` de novo, constrói o site e o publica no Cloudflare Pages. O `map-pilot-refresh` segue o mesmo caminho com `data/map-pilot`.

Cinco pontos dessa cadeia dependiam de entradas que podiam mudar sem passar por revisão no repositório.

1. Três passos de `ci.yml` e `pages.yml` usavam `actions/cache@v6`. O dono da ação pode mover a tag para outro commit. Em 2026-11-14, `v6` e `v6.1.0` apontam para o mesmo commit, `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`, que o cron já usava. As outras ações já estavam fixadas por SHA.
2. O job `publish` fazia o commit do artefato sem verificá-lo. A verificação rodava antes do upload, em outro job, e no `pages.yml`, quando os dados já estavam na `master`.
3. As anotações `::warning` e `::error` podem citar texto de terceiros. O runner lê um comando em toda linha que começa com `::`, termina as propriedades no primeiro `::` e cada propriedade na vírgula seguinte. `daily_puzzles_cli.warn` e `scripts/rebuild_database.py` escapavam a mensagem, cada um com a própria função, e deixavam o título sem escape. `scripts/publish_via_pr.py` imprimia sem escape o erro, que cita o stderr do `gh`. O passo de staging montava a anotação com a lista de caminhos HTML, um por linha. O passo do IndexNow imprimia no log o corpo da resposta remota.
4. `PUBLIC_GA4_ID` e `PUBLIC_CF_BEACON_TOKEN` vinham de `secrets`. Os dois são IDs públicos e aparecem em todas as páginas que o build gera. `PUBLIC_TBBC_SITE_KEY` já vinha de `vars`.
5. O deploy usava `cloudflare/wrangler-action` com `wranglerVersion: "4.147.0"`. A ação procura o wrangler instalado com `npx --no-install wrangler --version`. Sem um wrangler local nessa versão, ela roda `npm i wrangler@4.147.0` no job que recebe o `CLOUDFLARE_API_TOKEN`. Sem lockfile, o npm resolve as dependências transitivas do wrangler na hora, e dois deploys podiam rodar versões diferentes delas.

## Decisão

### Ações fixadas por SHA

Toda ação de terceiros usa o SHA completo de 40 caracteres, com a versão exata num comentário como `# v6.1.0`. Os três passos de cache usam agora `actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0`, o mesmo do cron. O commit é o mesmo da tag `v6`, então o comportamento do cache fica igual. Sem a `wrangler-action`, o job que recebe o token do Cloudflare só roda ações da organização `actions`.

### Verificação depois do download

O job `publish` do cron ganha o passo `Verify downloaded data`, entre `Apply generated data` e `Publish via pull request`. Ele roda `python3 -m kpop_scraping.web_publish --output-dir web/public/data --verify` com os mesmos `--require-*` de `npm run artifacts:verify`. Com o registro `daily-set.json` do [ADR 037](037-publicacao-parcial-do-dia.md), o mesmo comando aceita o dia parcial que o job de geração aceitou. O código que verifica é o do checkout da `master`, e os arquivos verificados são os que o commit vai levar.

O `map-pilot-refresh` publica `data/map-pilot/deadline-events.json`, e o `web_publish` não verifica esse arquivo. No job de geração, o passo `Validate the refreshed dataset` roda `tests.test_map_pilot_refresh`, cujo teste `test_committed_dataset_is_valid` chama `validate_map_pilot_dataset` sobre o arquivo. O job `publish` ganha o passo `Verify downloaded dataset` com `python3 -m kpop_scraping.map_pilot_refresh --verify --output data/map-pilot/deadline-events.json`. A opção lê o arquivo e o mapa `web/src/data/map-pilot/world-map.json`, chama a mesma função sem fazer requisição e sai com 1 quando o arquivo falta, não é JSON ou reprova na validação. Os testes web do mapa ficam só no job de geração, porque exigem `npm ci` no job que tem permissão de escrita.

Os dois passos usam o `python3` do runner, como o `publish_via_pr.py` do ADR 031. Nenhum deles tem `if:` ou `continue-on-error`, então uma falha encerra o job antes do `git add`.

### Anotações escapadas

`kpop_scraping/workflow_commands.py` concentra o escape com as regras do `@actions/core`. `escape_data` troca `%` por `%25`, CR por `%0D` e LF por `%0A` na mensagem. `escape_property` aplica as mesmas trocas e também `:` por `%3A` e `,` por `%2C` nas propriedades, como `title` e `file`. `warning`, `error` e `notice` imprimem uma linha com `flush=True`. O módulo usa só a biblioteca padrão e não faz nada na importação.

Todos os pontos Python que emitem anotação chamam o helper: `daily_puzzles_cli.warn`, os dois avisos de `cli.py`, os três de `scripts/rebuild_database.py`, o erro de `scripts/publish_via_pr.py` e o erro de `map_pilot_refresh --verify`. `scripts/publish_via_pr.py` põe a raiz do repositório no `sys.path`, como `scripts/rebuild_database.py`, para importar o pacote. Um texto sem esses cinco caracteres sai igual ao de antes, e os testes que comparam as anotações existentes passam sem mudança de expectativa. Um teste falha quando um arquivo Python de `kpop_scraping/` ou `scripts/` escreve `"::warning`, `"::error` ou `"::notice` sem o helper.

Nos workflows, só o passo de staging monta uma anotação com texto de comando. Ele escapa `%`, CR e LF da lista de caminhos com expansão de parâmetro do bash antes do `echo`, e a lista vira uma anotação só. O passo do IndexNow imprime o corpo da resposta com `jq -Rs .`, que o transforma numa única string JSON, e nenhuma linha dele começa com `::`. As outras anotações dos workflows têm texto fixo ou o código HTTP de três dígitos do `curl`.

### IDs de analytics em variáveis

Cada leitura de `PUBLIC_GA4_ID` e `PUBLIC_CF_BEACON_TOKEN` no `pages.yml` usa `${{ vars.NOME || secrets.NOME }}`. Uma variável inexistente vale string vazia na expressão, e o secret entra como reserva. Com a variável criada, ela vence. O operador precisa:

1. criar as variáveis de repositório `PUBLIC_GA4_ID` e `PUBLIC_CF_BEACON_TOKEN`, com os mesmos valores dos secrets atuais;
2. conferir no run seguinte do `pages.yml` que o build de produção mantém o beacon e o banner;
3. apagar os secrets `PUBLIC_GA4_ID` e `PUBLIC_CF_BEACON_TOKEN`.

Depois do passo 3, a parte `|| secrets.NOME` lê vazio e pode sair do workflow numa mudança posterior. Um teste falha quando `secrets.PUBLIC_` aparece sem a variável na frente.

### wrangler do lockfile

`web/package.json` lista `wrangler` em `devDependencies` na versão exata `4.147.0`, a mesma da `wranglerVersion` anterior. O `web/package-lock.json` ganha o wrangler e 54 dependências transitivas, e nenhuma versão de pacote existente muda. No `sharp`, no `sharp/node_modules/semver` e no `@img/colour`, que o lockfile já tinha, a marca `optional` vira `devOptional`, porque o `miniflare` também depende do `sharp`.

O job `deploy` faz checkout sem credenciais para ler o `package.json` e o lockfile, configura o Node 24 sem cache e roda `npm ci --ignore-scripts --no-audit --no-fund` em `web/`. O deploy chama `npx --no-install wrangler pages deploy dist --project-name=kpopquiz --branch=master` com `CLOUDFLARE_API_TOKEN` e `CLOUDFLARE_ACCOUNT_ID` no ambiente do passo. Sem o wrangler no `node_modules`, o `--no-install` falha o passo e nada é baixado do registro.

No lockfile, só `esbuild`, `workerd` e `fsevents` declaram script de instalação, e `fsevents` só instala no macOS. O `install.js` do `esbuild` e o do `workerd` conferem o binário do pacote da plataforma, como `@esbuild/linux-x64` e `@cloudflare/workerd-linux-64`, e o baixam quando o pacote falta. O `npm ci` instala esses pacotes pelo lockfile, então o wrangler funciona sem os scripts e o job não precisa de `npm rebuild`. Numa cópia com Node 26.13.1 e npm 11.20.0, `npm ci --ignore-scripts` instalou 429 pacotes, `npx --no-install wrangler --version` respondeu `4.147.0`, o `esbuild` 0.28.1 transformou TypeScript e o `workerd --version` respondeu. O `pages deploy` de um diretório estático sem `_worker.js` nem `functions/` não usa nenhum dos dois.

O Dependabot já atualiza o npm de `/web` toda semana, com as atualizações menores e de correção num grupo. Com o wrangler no lockfile, os PRs dele também atualizam o wrangler e as dependências dele.

## Alternativas consideradas

### Manter a `wrangler-action` com `npm ci` antes

A ação usa o wrangler local quando a versão bate com `wranglerVersion`. Quando o Dependabot atualizar o lockfile e o workflow ficar com a versão antiga, ou quando o `npm ci` não instalar o wrangler, ela volta a rodar `npm i wrangler@<versão>` sem falhar. Sem `wranglerVersion`, ela usaria qualquer wrangler instalado e, sem nenhum, instalaria o `wrangler@4`. O passo direto falha nesses casos. As saídas da ação, como a URL do deploy, não eram lidas pelo workflow.

### Lockfile separado só com o wrangler

Um `package.json` próprio do deploy instalaria menos pacotes no job do token. Ele exigiria outro lockfile e outra entrada no Dependabot. Com `--ignore-scripts`, nenhum pacote roda código na instalação, e o deploy só executa o wrangler.

### Rodar `tests.test_map_pilot_refresh` no job de publicação

O teste chama a mesma função, mas leva ao job com permissão de escrita os testes do parser e dos clientes HTTP simulados. A opção `--verify` roda só a validação do arquivo.

### Envolver o corpo do IndexNow em `::stop-commands::`

O runner ignora comandos entre `::stop-commands::<token>` e `::<token>::`. A solução exigiria gerar um token por execução. O `jq` já roda no passo e uma linha JSON tem o mesmo efeito.

## Consequências

- Antes do wrangler, `fsevents` era o único pacote do lockfile com script de instalação. Os `npm ci` que rodam com scripts, em `ci.yml`, no build do `pages.yml`, no `staging.yml`, no `e2e-nightly.yml`, no cron e no `map-pilot-refresh`, executam agora o `install.js` do `esbuild` e o do `workerd`. Nenhum desses jobs recebe o token do Cloudflare.
- O job `deploy` instala as dependências de `web/` sem cache a cada deploy. Na cópia local, o `npm ci --ignore-scripts` levou 19,5 s.
- O job `deploy` tem agora um checkout do repositório. O wrangler pode ler dele o commit do deploy, que antes não existia no job.
- O job `publish` verifica com o código da `master` no momento da publicação. Se a `master` mudar as regras de verificação durante a geração, um artefato gerado pelas regras antigas pode reprovar, e o dia espera um novo run. O `pages.yml` reprovaria o mesmo artefato depois do merge.
- Um PR do Dependabot que atualize o wrangler muda o `web/package-lock.json` e só toca o deploy depois do merge. O CI não roda o deploy, e o primeiro uso da versão nova acontece na `master`.
- Os secrets `PUBLIC_*` continuam valendo até o operador criar as variáveis. O build de produção não muda enquanto isso.
- Nenhum run do GitHub Actions exercitou essas mudanças antes do merge. A sintaxe passou pelo `actionlint` 1.7.7 sem shellcheck, e os testes de `tests/test_workflow_integrity.py` e `tests/test_workflow_commands.py` leem os workflows como texto.
