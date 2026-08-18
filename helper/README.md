# LiveBrazil Helper e Launcher

Serviço Node.js local que controla uma conexão VPN nativa já cadastrada no Windows. Consulte o [README principal](../README.md) para o fluxo completo.

## Configuração

Copie `config/config.example.json` para `config/config.json`:

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

`host` existe para tornar a intenção explícita, mas o código sempre faz bind em `127.0.0.1`. Porta, tempos e nome são validados. O nome nunca é aceito em query string, body ou header.

## Uso

```powershell
npm install
npm start
```

`npm start` inicia somente a API localhost. Para iniciar uma nova sessão do Discord através da VPN e depois restaurar a rota Brasil:

```powershell
npm run launch
```

O launcher fecha o Discord existente, conecta a VPN, abre o canal configurado, confirma duas amostras de conexão TCP estabelecida, aguarda a estabilização e desliga a VPN. Em falhas, tenta restaurar a rota Brasil; se havia fechado o Discord antes de a VPN conectar, também tenta reabri-lo normalmente.

O token é criado em `data/auth-token.txt`. Não compartilhe nem versione esse arquivo. Logs operacionais ficam em `logs/voiceroute.log` e nunca incluem token ou credenciais.

## Gerar o executável portátil

```powershell
npm run build:exe
```

O resultado é `dist/LiveBrazil.exe`. A build usa o IExpress que acompanha o Windows para incorporar `standalone/LiveBrazil.ps1` em um único executável. O outro computador não precisa de Node.js nem de arquivos adicionais.

O executável abre um splash flutuante sem moldura, exibe o avatar incorporado e inicia o processo automaticamente. O script é empacotado com BOM UTF-8 para preservar os acentos no Windows PowerShell 5.1. Depois do UAC, cria ou atualiza o perfil global fixo `LiveBrazil`, encerra os processos da instalação do Discord com fallback por nomes fixos quando o Windows oculta seus caminhos, conecta a VPN, confirma a rota padrão e inicia um processo novo pelo shell normal do usuário. Depois exige janela e conexões TCP estáveis, restaura a rota Brasil e fecha o splash sozinho. Ele não está assinado digitalmente.

## Endpoints

| Método | Caminho | Autenticação | Função |
|---|---|---:|---|
| GET | `/health` | não | saúde e versão |
| GET | `/vpn/status` | Bearer | existência e estado confirmado |
| POST | `/vpn/on` | Bearer | conecta, serializa e aguarda confirmação |
| POST | `/vpn/off` | Bearer | desconecta, serializa e aguarda confirmação |

Exemplo local no PowerShell:

```powershell
$vrToken = (Get-Content -Raw .\data\auth-token.txt).Trim()
Invoke-RestMethod http://127.0.0.1:28471/vpn/status -Headers @{ Authorization = "Bearer $vrToken" }
```

Não há endpoint genérico. Query strings e bodies nas rotas VPN são rejeitados; rotas desconhecidas retornam 404.

## Implementação Windows

`Get-VpnConnection` procura primeiro a conexão do usuário e depois uma conexão global (`-AllUserConnection`). O nome é transportado em `VOICEROUTE_VPN_NAME` para um script PowerShell constante, não concatenado. `rasdial.exe` recebe o nome e `/disconnect` como argumentos separados. A conclusão é decidida por consultas repetidas a `Get-VpnConnection`, nunca pelo exit code isolado do comando.

Credenciais precisam estar memorizadas no perfil VPN do Windows. Se a conexão exigir interação ou não tiver credenciais salvas, `rasdial` poderá falhar e o helper retornará timeout/erro sem coletar a senha.

O erro `rasdial 691` significa que o Windows recusou usuário/senha ou não encontrou credenciais válidas salvas. Abra **Configurações → Rede e Internet → VPN → VoiceRoute Canada**, conecte manualmente, corrija as credenciais e confirme que o Windows consegue conectar sem solicitar novos dados. O LiveBrazil não recebe nem armazena essas credenciais.

Se `rasdial` retornar 691 mas o perfil existir, o helper tenta `rasphone.exe -d "VoiceRoute Canada"`, que usa o conector nativo interativo semelhante ao painel do Windows. O nome continua vindo exclusivamente do JSON e nenhuma credencial passa pelo Node. Dependendo da configuração do perfil, o Windows pode abrir sua própria janela de conexão; conclua-a dentro do timeout configurado.

## Testes

```powershell
npm test
```

A suíte cobre idempotência, serialização do mutex/fila, VPN ausente, autenticação, CORS e ausência dos endpoints perigosos. Testes contra VPN real são manuais porque alteram a rota da máquina.
