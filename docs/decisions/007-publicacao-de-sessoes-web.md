# ADR 007: publicação versionada de sessões web

## Status

Aceita

## Data

2026-09-13

## Contexto

O site estático precisa receber perguntas produzidas pelo pipeline Python. O GitHub Pages não tem acesso ao SQLite usado na coleta. O build também precisa falhar quando alguém altera ou remove um arquivo publicado sem atualizar seu manifesto.

## Decisão

O comando `python -m kpop_scraping.web_publish` publica duas sessões validadas em `web/public/data`, uma para `pt-BR` e outra para `en`. As sessões vêm da mesma versão do dataset. O comando aceita um SQLite em modo de leitura ou dois arquivos produzidos por `quiz_cli`.

`manifest.json` registra a versão do dataset, o caminho, o ID e o SHA-256 de cada sessão. `--verify` valida os três arquivos e compara o manifesto recalculado byte a byte com o objeto publicado. O workflow executa essa verificação antes dos testes e do build. Ele não tenta recriar dados porque o ambiente do GitHub Actions não contém o banco de coleta.

O frontend busca primeiro o manifesto e depois a sessão do idioma selecionado. Ambos os caminhos partem de `BASE_URL`. O carregador calcula o SHA-256 dos bytes recebidos antes do parse e compara o resultado com o manifesto. Em seguida, valida o schema da sessão, o idioma, a versão do dataset e o ID declarado. Um HTTP 404 produz o estado de artefato ausente. Falhas de hash, parse, schema ou identidade produzem o estado de artefato inválido.

Cada arquivo usa escrita atômica. O publicador grava o manifesto por último, como marcador da versão completa. Se uma falha de sistema interromper a troca dos três arquivos, `--verify` rejeita o diretório antes do build. Essa regra evita publicar uma combinação parcial no GitHub Pages.

A interface mantém o localizador completo no JSON para auditoria. Após a resposta, ela mostra somente o domínio ou o projeto de origem, a revisão e o link consultável. O localizador de afirmações do Wikidata não faz parte do texto apresentado ao jogador.

## Alternativas consideradas

### Gerar perguntas durante o workflow

Essa opção exigiria publicar o SQLite ou refazer a coleta no CI. A coleta depende da rede, e o SQLite contém estados editoriais que não fazem parte do repositório. O workflow verifica os arquivos versionados.

### Importar a sessão no bundle TypeScript

Essa opção exigiria recompilar código para trocar perguntas e manteria a amostra editorial no caminho de produção. Arquivos em `public/data` preservam a separação entre aplicação e conteúdo.

### Buscar apenas a sessão

O schema da sessão detecta estrutura inválida. Ele não detecta substituição coordenada de identidade ou divergência entre idiomas. O manifesto adiciona a versão comum e os IDs esperados.

## Consequências

- A publicação de conteúdo exige executar o comando e versionar os três JSONs.
- O mesmo SQLite gera os dois idiomas sem duplicar fatos na fonte local.
- O deploy falha se os arquivos divergirem do manifesto.
- O CI e o navegador conferem o SHA-256 de cada sessão.
- Os schemas JSON declarativos ainda cobrem dataset e sessão. O manifesto usa validadores Python e TypeScript nesta fatia.
