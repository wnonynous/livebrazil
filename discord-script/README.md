# Script Discord do LiveBrazil

`voiceroute.js` é colado manualmente no Console do DevTools do Discord Desktop. Ele só observa/interage com o DOM e chama `http://127.0.0.1:28471`. Não acessa token da conta, cookies, mensagens, DMs ou serviços externos.

## Papel no fluxo atual

A sessão completa do Discord agora é iniciada pelo comando `npm run launch` no helper. Como reiniciar o Discord destrói qualquer JavaScript do F12, este arquivo funciona como GUI opcional, diagnóstico e controle manual. `auto` inicia desativado para não executar uma segunda troca de VPN ao clicar numa call.

## Carregamento e autenticação

Cole o arquivo inteiro. A saúde pública será verificada imediatamente. Quando `status`, `test`, `connect` ou o fluxo automático precisar de uma rota VPN, uma janela da própria GUI pedirá o token de `helper/data/auth-token.txt`; ele fica só em memória. O script não usa `window.prompt()`, pois esse recurso é bloqueado em algumas versões do Discord. Use `LiveBrazil.setToken(...)` se preferir defini-lo antes. `VoiceRoute` permanece como alias compatível.

## Detecção do DOM

Todos os seletores ficam no objeto `DiscordSelectors`, no início do arquivo, e também em `VoiceRoute.DiscordSelectors`. Eles usam atributos semânticos e não classes ofuscadas:

- `channelItem`: `data-list-item-id` de canal;
- `voiceIcon`: `data-icon`/`aria-label` que distingue voz;
- `voiceCallButton`: botão semântico de call;
- `disconnectButton`: evidência conservadora de voz conectada;
- `connectingIndicator`: status/aria-live de conexão;
- `appRoot`: raiz observada pelo `MutationObserver`.
- `userSettingsButton`: botão semântico de configurações usado para localizar o painel de perfil.

## GUI LiveBrazil

O script insere um painel **LiveBrazil** imediatamente acima do painel de perfil. Ele segue as cores e dimensões visuais do Discord e mostra rota atual, Helper, VPN e voz. Os botões permitem controlar a VPN manualmente. O botão Auto permanece desligado no fluxo recomendado.

A posição não depende de uma classe interna: o script encontra o botão `aria-label` de configurações do usuário, sobe até o menor contêiner que represente a barra de perfil e insere o indicador antes desse contêiner. Se o Discord trocar o rótulo, atualize somente `DiscordSelectors.userSettingsButton`. Também é possível remontar manualmente com `VoiceRoute.panel.mount()`.

A instalação atual do Discord precisa ser validada manualmente no inspetor. Se um atributo mudar, altere apenas a propriedade correspondente. O fallback periódico roda a cada 750 ms e somente durante uma tentativa automática.

Com `auto(false)`, calls, compartilhamento de tela e os demais controles do Discord não são interceptados. `auto(true)` mantém o fluxo legado por clique apenas para testes e não deve ser combinado com o launcher.

## Concorrência e cancelamento

O script intercepta apenas `click`, não `pointerdown`, registra uma única ação e bloqueia cliques adicionais durante o processamento. O replay usa `internalBypass` e ocorre uma vez. Se o nó tiver sido removido, a ação falha de forma segura e pede novo clique. Sair da call antes do delay impede que a VPN seja desligada pelo fluxo automático naquela tentativa (ela ainda pode ser desligada manualmente).

## CORS/CSP

O helper reflete apenas origens Discord conhecidas ou `null`. Ainda assim, a política CSP da página é aplicada pelo próprio Discord e pode proibir localhost em certas builds. CORS no servidor não consegue relaxar uma CSP imposta pelo cliente. Se `fetch` falhar mesmo com o helper online, confira o Console/Network e use o modo manual ou uma versão do Discord em que DevTools e localhost estejam permitidos; não desabilite proteções globais sem entender o risco.
