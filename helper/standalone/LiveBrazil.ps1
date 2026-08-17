param([switch]$Run)

$ErrorActionPreference = 'Stop'
$VpnName = 'VPN Japão'
$VpnServer = 'public-vpn-109.opengw.net'
$VpnPsk = 'vpn'
$VpnUser = 'vpn'
$VpnPassword = 'vpn'
$DiscordRoot = Join-Path $env:LOCALAPPDATA 'Discord'
$DiscordUpdate = Join-Path $DiscordRoot 'Update.exe'
$StatusRoot = Join-Path $env:LOCALAPPDATA 'LiveBrazil'
$StatusPath = Join-Path $StatusRoot 'status.log'

function Write-Status([string]$Message) {
    if (-not (Test-Path -LiteralPath $StatusRoot)) {
        New-Item -ItemType Directory -Path $StatusRoot -Force | Out-Null
    }
    $line = '{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), ($Message -replace '[\r\n]+', ' ')
    Add-Content -LiteralPath $StatusPath -Value $line -Encoding UTF8
}

function Get-ManagedVpn {
    Get-VpnConnection -Name $VpnName -AllUserConnection -ErrorAction SilentlyContinue
}

function Wait-VpnState([bool]$Connected, [int]$TimeoutSeconds = 30) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $vpn = Get-ManagedVpn
        $current = $vpn -and $vpn.ConnectionStatus -eq 'Connected'
        if ($current -eq $Connected) { return $true }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Provision-Vpn {
    Write-Status 'Criando ou atualizando o perfil VPN Japão...'
    $userProfile = Get-VpnConnection -Name $VpnName -ErrorAction SilentlyContinue
    if ($userProfile) {
        Remove-VpnConnection -Name $VpnName -Force -Confirm:$false
    }
    $profile = Get-ManagedVpn
    if ($profile) {
        Set-VpnConnection -Name $VpnName -ServerAddress $VpnServer -TunnelType L2tp -L2tpPsk $VpnPsk -AuthenticationMethod MSChapv2 -EncryptionLevel Optional -RememberCredential $true -SplitTunneling $false -AllUserConnection -Force -PassThru | Out-Null
    } else {
        Add-VpnConnection -Name $VpnName -ServerAddress $VpnServer -TunnelType L2tp -L2tpPsk $VpnPsk -AuthenticationMethod MSChapv2 -EncryptionLevel Optional -RememberCredential -AllUserConnection -Force -PassThru | Out-Null
    }
    $check = Get-ManagedVpn
    if (-not $check -or $check.ServerAddress -ne $VpnServer -or $check.TunnelType -ne 'L2tp') {
        throw 'O perfil VPN não pôde ser validado.'
    }
    Write-Status 'Perfil VPN pronto.'
}

function Stop-Discord {
    $items = @(Get-Process -Name Discord -ErrorAction SilentlyContinue)
    if ($items.Count -eq 0) { return $false }
    Write-Status 'Encerrando a sessão atual do Discord...'
    foreach ($item in $items) {
        if ($item.MainWindowHandle -ne 0) { [void]$item.CloseMainWindow() }
    }
    $deadline = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $deadline) {
        if (-not (Get-Process -Name Discord -ErrorAction SilentlyContinue)) { return $true }
        Start-Sleep -Milliseconds 500
    }
    Get-Process -Name Discord -ErrorAction SilentlyContinue | Stop-Process -Force
    return $true
}

function Start-Discord {
    if (-not (Test-Path -LiteralPath $DiscordUpdate)) {
        throw 'Discord Stable não foi encontrado em LOCALAPPDATA.'
    }
    Start-Process -FilePath $DiscordUpdate -ArgumentList '--processStart', 'Discord.exe' -WorkingDirectory $DiscordRoot
}

function Wait-DiscordSession([int]$TimeoutSeconds = 60) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $samples = 0
    do {
        $ids = @(Get-Process -Name Discord -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
        $established = @()
        if ($ids.Count -gt 0) {
            $established = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess })
        }
        if ($established.Count -gt 0) {
            $samples++
            if ($samples -ge 2) { return $true }
        } else {
            $samples = 0
        }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Disconnect-ManagedVpn {
    $vpn = Get-ManagedVpn
    if ($vpn -and $vpn.ConnectionStatus -eq 'Connected') {
        $null = & rasdial.exe $VpnName /disconnect 2>&1
    }
    if (-not (Wait-VpnState -Connected $false -TimeoutSeconds 20)) {
        throw 'A VPN não confirmou a desconexão.'
    }
}

function Run-Workflow {
    New-Item -ItemType Directory -Path $StatusRoot -Force | Out-Null
    Set-Content -LiteralPath $StatusPath -Value 'LiveBrazil iniciado.' -Encoding UTF8
    $wasRunning = $false
    $discordStarted = $false
    $vpnConnected = $false
    try {
        $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
            throw 'O processo precisa de permissão de administrador.'
        }
        Provision-Vpn
        $wasRunning = Stop-Discord
        Write-Status 'Conectando a VPN Japão...'
        $null = & rasdial.exe $VpnName $VpnUser $VpnPassword 2>&1
        if (-not (Wait-VpnState -Connected $true -TimeoutSeconds 30)) {
            throw 'O Windows não conseguiu conectar a VPN Japão.'
        }
        $vpnConnected = $true
        Write-Status 'VPN conectada. Iniciando o Discord...'
        Start-Discord
        $discordStarted = $true
        Write-Status 'Aguardando a sessão de rede do Discord...'
        if (-not (Wait-DiscordSession -TimeoutSeconds 60)) {
            throw 'O Discord não estabeleceu a sessão dentro do tempo limite.'
        }
        Write-Status 'Sessão estabelecida pela VPN. Estabilizando por 5 segundos...'
        Start-Sleep -Seconds 5
        Write-Status 'Restaurando a rota Brasil...'
        Disconnect-ManagedVpn
        $vpnConnected = $false
        Write-Status 'Concluído. Discord aberto na rota Brasil.'
    } catch {
        Write-Status ('Falha: ' + $_.Exception.Message)
        $cleanupVpn = Get-ManagedVpn
        if ($cleanupVpn -and $cleanupVpn.ConnectionStatus -eq 'Connected') {
            try { Disconnect-ManagedVpn; Write-Status 'Rota Brasil restaurada após a falha.' } catch { Write-Status 'Não foi possível confirmar a restauração da rota Brasil.' }
        }
        if ($wasRunning -and -not $discordStarted) {
            try { Start-Discord; Write-Status 'Discord reaberto pela rota Brasil.' } catch {}
        }
        exit 1
    }
}

function Show-Gui {
    Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
    [xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="LiveBrazil" Width="520" Height="430" WindowStartupLocation="CenterScreen" ResizeMode="NoResize" Background="#1E1F22" Foreground="#F2F3F5">
  <Grid Margin="24">
    <Grid.RowDefinitions><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="Auto"/><RowDefinition Height="*"/><RowDefinition Height="Auto"/></Grid.RowDefinitions>
    <TextBlock Grid.Row="0" Text="LiveBrazil" FontSize="28" FontWeight="Bold" Margin="0,0,0,4"/>
    <TextBlock Grid.Row="1" Text="Inicie o Discord pela VPN e retorne automaticamente ao Brasil" Foreground="#B5BAC1" FontSize="13" Margin="0,0,0,18"/>
    <Border Grid.Row="2" Background="#2B2D31" CornerRadius="7" Padding="14" Margin="0,0,0,14"><StackPanel><TextBlock Text="VPN Japão" FontWeight="Bold" FontSize="14"/><TextBlock Text="public-vpn-109.opengw.net  •  L2TP/IPsec" Foreground="#949BA4" FontSize="12" Margin="0,4,0,0"/><TextBlock Text="O Windows solicitará permissão de administrador para criar o perfil." Foreground="#DBDEE1" TextWrapping="Wrap" FontSize="11" Margin="0,9,0,0"/></StackPanel></Border>
    <Border Grid.Row="3" Background="#111214" CornerRadius="6" Padding="12"><ScrollViewer VerticalScrollBarVisibility="Auto"><TextBlock Name="StatusText" Text="Pronto para iniciar." Foreground="#B5BAC1" FontFamily="Consolas" FontSize="11" TextWrapping="Wrap"/></ScrollViewer></Border>
    <Grid Grid.Row="4" Margin="0,16,0,0"><Grid.ColumnDefinitions><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><Button Name="StartButton" Grid.Column="0" Content="Preparar VPN e iniciar Discord" Height="40" Background="#5865F2" Foreground="White" BorderThickness="0" FontWeight="Bold" Margin="0,0,10,0"/><Button Name="CloseButton" Grid.Column="1" Content="Fechar" Width="90" Height="40" Background="#4E5058" Foreground="White" BorderThickness="0"/></Grid>
  </Grid>
</Window>
'@
    $reader = New-Object System.Xml.XmlNodeReader $xaml
    $window = [Windows.Markup.XamlReader]::Load($reader)
    $startButton = $window.FindName('StartButton')
    $closeButton = $window.FindName('CloseButton')
    $statusText = $window.FindName('StatusText')
    $child = $null
    $timer = New-Object Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(500)
    $timer.Add_Tick({
        if (Test-Path -LiteralPath $StatusPath) {
            try { $statusText.Text = [IO.File]::ReadAllText($StatusPath, [Text.Encoding]::UTF8) } catch {}
        }
        if ($child -and $child.HasExited) {
            $startButton.IsEnabled = $true
            $startButton.Content = 'Executar novamente'
            $child = $null
        }
    })
    $startButton.Add_Click({
        try {
            New-Item -ItemType Directory -Path $StatusRoot -Force | Out-Null
            Set-Content -LiteralPath $StatusPath -Value 'Solicitando permissão do Windows...' -Encoding UTF8
            $startButton.IsEnabled = $false
            $arguments = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Run' -f $PSCommandPath
            $child = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -PassThru
        } catch {
            $startButton.IsEnabled = $true
            $statusText.Text = 'A operação foi cancelada ou não pôde ser iniciada.'
        }
    })
    $closeButton.Add_Click({ $window.Close() })
    $window.Add_Closed({ $timer.Stop() })
    $timer.Start()
    [void]$window.ShowDialog()
}

if ($Run) { Run-Workflow } else { Show-Gui }
