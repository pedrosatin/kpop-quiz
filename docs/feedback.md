# Feedback do quiz

O piloto pergunta se a pessoa gostou da partida após concluir o quiz, em português ou inglês. Não aparece em desistências. A pergunta pode ser dispensada; após dispensa ou voto confirmado, uma marca local impede que volte nas próximas partidas neste navegador. Limpar o armazenamento do navegador remove essa marca. Se o armazenamento estiver indisponível, a supressão não persiste.

A interface é do Ponder Club e usa a [API da TBBC](https://tbbc.app/rating-widget/#api), sem carregar o script remoto. O voto envia a chave pública, o valor, a seção fixa `quiz-result`, o app `ponder-club` e o idioma. O comentário opcional é enviado junto de um nonce, sem nome ou contato. Não são enviados caminho real, identificadores da conta ou da partida, cookies, credenciais ou referer. A TBBC recebe e armazena a resposta e, como em qualquer conexão direta, recebe metadados de rede, incluindo o IP. O aviso pede que a pessoa não inclua dados pessoais no texto livre.

O voto só é confirmado com status 201, `ok: true` e ID não vazio. Não há repetição automática; uma tentativa manual após resposta perdida pode duplicar o voto. Comentários exigem status 200 e o mesmo ID; em caso de falha o texto permanece e uma nova tentativa do mesmo texto usa o mesmo nonce e ID. Sair do resultado cancela a requisição e ignora respostas posteriores; o cancelamento não desfaz dados já recebidos pelo servidor. O feedback não interfere no resultado da partida.

## Configuração e rollback

Crie inboxes separados para produção e testes. Guarde o acesso administrativo fora do repositório. A chave `k_` é pública e fica no JavaScript do build; não coloque credenciais administrativas nela. Para desenvolvimento, defina `PUBLIC_TBBC_SITE_KEY` em `web/.env.local`. Para produção, defina a variável de repositório `PUBLIC_TBBC_SITE_KEY` no GitHub Actions: é esse workflow que constrói o site antes do deploy no Cloudflare Pages. A homologação não recebe a variável de produção. Sem chave, a interface fica oculta e não há chamadas à TBBC.

Para desativar, remova ou esvazie a variável e faça novo build e deploy; alternativamente reverta a mudança e publique novamente. Isso não apaga respostas já armazenadas na TBBC. Confira a disponibilidade e o recebimento após o deploy: testes locais com respostas simuladas não comprovam que a configuração de produção está ativa.
