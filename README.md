# LiveBrazil 1.0.0

LiveBrazil inicia uma nova sessão do Discord Desktop através de uma VPN nativa do Windows e, depois que a sessão de rede fica estabelecida, desliga a VPN para restaurar a rota Brasil.

Não usa WireGuard, Wintun, OpenVPN, Tailscale, Python nem um aplicativo Electron próprio.

## Fluxo atual

```text
Discord aberto ou fechado na rota Brasil
              |
              v
       npm run launch
              |
              v
Fecha o Discord antigo, se necessário
              |
              v
Conecta "VoiceRoute Canada"
              |
              v
Inicia o Discord pela VPN
              |
              v
Confirma duas amostras TCP estabelecidas
              |
              v
Aguarda estabilização da sessão
              |
              v
Desliga a VPN e restaura a rota Brasil
```

O script F12 não pode sobreviver a um reinício do Discord. Por isso, o launcher Node.js é responsável por iniciar a sessão. O modo automático por clique ficou desativado por padrão; o script F12 agora é apenas uma GUI e ferramenta de diagnóstico/manual.

## Requisitos

- Windows 10 ou 11;
- Node.js 18 ou mais recente;
- Discord Desktop instalado pelo instalador tradicional em `%LOCALAPPDATA%`;
- VPN nativa do Windows chamada `VoiceRoute Canada`;
- credenciais cadastradas no próprio Windows.

O computador testado possui Discord Stable em `%LOCALAPPDATA%\Discord\Update.exe`. PTB e Canary também são suportados por configuração.

## Configurar a VPN

1. Abra **Configurações → Rede e Internet → VPN → Adicionar VPN**.
2. Escolha **Windows (interno)**.
3. Use `VoiceRoute Canada` como nome da conexão.
4. Use as informações do seu provedor; `vpn.example.com` é apenas um exemplo.
5. Salve as credenciais pelo Windows e teste manualmente uma conexão completa.

O perfil desta máquina foi identificado como L2TP/MS-CHAPv2. O LiveBrazil não lê, recebe, registra ou armazena usuário e senha da VPN.

## Executável portátil

O arquivo pronto está em:

```text
D:\LiveBrazil\VoiceRoute\helper\dist\LiveBrazil.exe
```

Você pode copiar somente esse `.exe` para outro computador Windows 10/11. O computador de destino não precisa de Node.js e não precisa cadastrar a VPN manualmente.

Ao abrir o programa:

1. aparece um splash flutuante compacto, sem moldura ou barra de título, usando a imagem do LiveBrazil como avatar;
2. o processo começa automaticamente, sem precisar clicar em nenhum botão;
3. aceite a solicitação do UAC;
4. o LiveBrazil cria ou atualiza uma conexão global chamada `LiveBrazil`;
5. encerra os processos da pasta do Discord e usa nomes fixos como fallback quando o Windows oculta o caminho, conecta a VPN e confirma a rota padrão;
6. inicia um processo novo pelo shell normal do usuário, exige janela aberta e conexões TCP estáveis, aguarda cinco segundos e desliga a VPN;
7. mostra a conclusão, fecha o splash sozinho e mantém o Discord aberto pela rota Brasil.

Se houver falha, o splash permanece aberto e oferece **Tentar novamente**. O detalhe técnico fica em `%LOCALAPPDATA%\LiveBrazil\status.log`.

Configuração incorporada no executável:

```text
Provedor: Windows (interno)
Conexão: LiveBrazil
Servidor: public-vpn-109.opengw.net
Tipo: L2TP/IPsec com chave pré-compartilhada
Autenticação: MS-CHAPv2, usuário e senha
```

As credenciais fornecidas são públicas e estão incorporadas no executável. Elas podem ser recuperadas por quem possuir o arquivo; não reutilize esse mecanismo para credenciais privadas. O servidor é público e de terceiros: pode ficar indisponível e seu operador pode observar metadados e destinos de tráfego, embora conexões HTTPS mantenham o conteúdo criptografado.

O executável não está assinado digitalmente. O Windows SmartScreen pode mostrar um aviso ao abri-lo em outro PC. O SHA-256 da build entregue está registrado na seção de testes abaixo.

## Instalação do projeto Node

```powershell
cd D:\LiveBrazil\VoiceRoute\helper
Copy-Item config\config.example.json config\config.json
npm install
```

Configuração do launcher:

```json
{
  "host": "127.0.0.1",
  "port": 28471,
  "vpnConnectionName": "VoiceRoute Canada",
  "disconnectDelay": 0,
  "requestTimeout": 15000,
  "discordChannel": "stable",
  "discordSessionTimeout": 60000,
  "sessionStabilizationDelay": 5000,
  "debug": true
}
```

`discordChannel` aceita somente `stable`, `ptb` ou `canary`. Caminhos e executáveis não são aceitos da GUI ou da API.

## Iniciar o Discord pelo LiveBrazil

Feche trabalhos não enviados no Discord e execute:

```powershell
cd D:\LiveBrazil\VoiceRoute\helper
npm run launch
```

O launcher:

- fecha o Discord existente pela janela principal;
- usa `taskkill` apenas como fallback e somente para o executável fixo do canal selecionado;
- conecta e confirma a VPN;
- inicia o Discord pelo `Update.exe` validado dentro de `%LOCALAPPDATA%`;
- procura conexões TCP `Established` pertencentes aos processos do Discord;
- exige duas amostras consecutivas;
- aguarda mais 5 segundos por padrão;
- desliga e confirma a VPN;
- tenta restaurar a rota Brasil mesmo quando alguma etapa falha.

Se `rasdial` retornar 691, o LiveBrazil abre `rasphone.exe -d "VoiceRoute Canada"`. O Windows pode mostrar sua janela nativa; conclua a conexão dentro do timeout. Nenhuma credencial passa pelo Node.

## Helper HTTP e GUI F12

O servidor HTTP continua disponível para diagnóstico e controle manual:

```powershell
npm start
```

Depois, se desejar a GUI dentro do Discord, cole [discord-script/voiceroute.js](discord-script/voiceroute.js) no Console. Ela expõe:

```js
await LiveBrazil.status()
await LiveBrazil.connect()
await LiveBrazil.disconnect()
await LiveBrazil.test()
LiveBrazil.auto(false)
LiveBrazil.panel.mount()
LiveBrazil.panel.refresh()
```

`VoiceRoute` permanece como alias compatível. Não use `LiveBrazil.auto(true)` no fluxo novo, pois isso reativa a automação antiga por clique e cria outra troca de VPN.

## Segurança

- bind HTTP invariável em `127.0.0.1`;
- Bearer criptográfico nas rotas VPN;
- nenhuma rota de shell, comando, PowerShell ou executável;
- nome da VPN somente do JSON;
- canal do Discord limitado a uma enumeração fixa;
- comandos executados com argumentos separados;
- scripts PowerShell constantes, com valores transportados por ambiente;
- executável do Discord resolvido e validado dentro de `%LOCALAPPDATA%`;
- nenhuma leitura de token Discord, cookies, mensagens ou DMs.

## Testes

```powershell
npm test
```

A suíte cobre o fluxo completo do launcher com dependências simuladas, restauração da VPN em falhas, mutex da VPN, erro 691, autenticação HTTP, CORS, rejeição de entradas arbitrárias e ausência de endpoints perigosos.

O launcher real não foi executado automaticamente durante o desenvolvimento porque isso fecharia o Discord desta conversa e alteraria a rota de rede. O caminho do Discord Stable foi validado como existente.

O `.exe` portátil foi gerado pelo IExpress nativo, o script interno passou pelo parser do PowerShell, o XAML do splash foi carregado em modo STA e o artefato final possui este SHA-256:

```text
F4AE01CACD2A4802B1880815DCDA573536687A7EB881ECD5136255F985BAEB20
```

Para reconstruí-lo:

```powershell
cd D:\LiveBrazil\VoiceRoute\helper
npm run build:exe
```

## Limitações

- uma conexão TCP estabelecida confirma tráfego de sessão do processo Discord, mas não inspeciona conteúdo, token ou protocolo privado;
- instalações da Microsoft Store não são detectadas nesta versão;
- o executável portátil procura o Discord Stable instalado em `%LOCALAPPDATA%\Discord`;
- o executável é autoextraível e não possui assinatura Authenticode;
- a criação da conexão global exige confirmação do UAC;
- o Windows pode exigir interação na janela `rasphone` para o perfil L2TP/MS-CHAPv2;
- durante a troca para Brasil, o Discord pode renegociar suas conexões de rede;
- a GUI F12 desaparece quando o launcher reinicia o Discord e precisa ser colada novamente se ainda for desejada.
