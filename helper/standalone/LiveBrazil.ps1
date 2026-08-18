param([switch]$Run)

$ErrorActionPreference = 'Stop'
$VpnName = 'LiveBrazil'
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

function Wait-VpnDefaultRoute([int]$TimeoutSeconds = 20) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        $interfaces = @(Get-NetIPInterface -InterfaceAlias $VpnName -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ConnectionState -eq 'Connected' })
        foreach ($interface in $interfaces) {
            $prefixes = @(Get-NetRoute -InterfaceIndex $interface.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty DestinationPrefix)
            $hasDefault = $prefixes -contains '0.0.0.0/0'
            $hasSplitDefault = ($prefixes -contains '0.0.0.0/1') -and ($prefixes -contains '128.0.0.0/1')
            $effectiveRoutes = @(Find-NetRoute -RemoteIPAddress '1.1.1.1' -ErrorAction SilentlyContinue)
            $vpnIsSelected = @($effectiveRoutes | Where-Object { $_.InterfaceIndex -eq $interface.InterfaceIndex }).Count -gt 0
            if (($hasDefault -or $hasSplitDefault) -and $vpnIsSelected) { return $true }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    return $false
}

function Provision-Vpn {
    Write-Status 'Criando ou atualizando o perfil LiveBrazil...'
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

function Get-DiscordProcesses {
    $rootPrefix = [IO.Path]::GetFullPath($DiscordRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        $_.ExecutablePath -and $_.ExecutablePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)
    })
}

function Stop-Discord {
    $items = @(Get-DiscordProcesses)
    if ($items.Count -eq 0) { return $false }
    Write-Status 'Encerrando completamente o Discord...'
    foreach ($item in $items) {
        try {
            $process = Get-Process -Id $item.ProcessId -ErrorAction Stop
            if ($process.MainWindowHandle -ne 0) { [void]$process.CloseMainWindow() }
        } catch {}
    }
    Start-Sleep -Seconds 2
    $deadline = (Get-Date).AddSeconds(15)
    do {
        $remaining = @(Get-DiscordProcesses)
        if ($remaining.Count -eq 0) {
            Write-Status 'Discord encerrado por completo.'
            return $true
        }
        foreach ($item in $remaining) {
            Stop-Process -Id $item.ProcessId -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw 'Não foi possível encerrar todos os processos do Discord.'
}

function Start-Discord {
    if (-not (Test-Path -LiteralPath $DiscordUpdate)) {
        throw 'Discord Stable não foi encontrado em LOCALAPPDATA.'
    }
    $startedAt = Get-Date
    Start-Process -FilePath $DiscordUpdate -ArgumentList '--processStart', 'Discord.exe' -WorkingDirectory $DiscordRoot
    return $startedAt
}

function Wait-DiscordSession([datetime]$StartedAfter, [int]$TimeoutSeconds = 75) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $samples = 0
    do {
        $newProcesses = @(Get-DiscordProcesses | Where-Object {
            $_.Name -ieq 'Discord.exe' -and $_.CreationDate -ge $StartedAfter.AddSeconds(-2)
        })
        $ids = @($newProcesses | Select-Object -ExpandProperty ProcessId)
        $hasWindow = $false
        foreach ($id in $ids) {
            try {
                if ((Get-Process -Id $id -ErrorAction Stop).MainWindowHandle -ne 0) { $hasWindow = $true; break }
            } catch {}
        }
        $established = @()
        if ($ids.Count -gt 0) {
            $established = @(Get-NetTCPConnection -State Established -ErrorAction SilentlyContinue | Where-Object { $ids -contains $_.OwningProcess })
        }
        if ($hasWindow -and $established.Count -gt 0) {
            $samples++
            if ($samples -ge 3) { return $true }
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
        Write-Status 'Conectando à VPN LiveBrazil...'
        $null = & rasdial.exe $VpnName $VpnUser $VpnPassword 2>&1
        if (-not (Wait-VpnState -Connected $true -TimeoutSeconds 30)) {
            throw 'O Windows não conseguiu conectar a VPN LiveBrazil.'
        }
        $vpnConnected = $true
        Write-Status 'VPN conectada. Confirmando a rota padrão...'
        if (-not (Wait-VpnDefaultRoute -TimeoutSeconds 20)) {
            throw 'A VPN conectou, mas a rota padrão não foi aplicada pelo Windows.'
        }
        Write-Status 'Rota da VPN confirmada.'
        if (@(Get-DiscordProcesses).Count -gt 0) {
            $null = Stop-Discord
        }
        Write-Status 'Iniciando uma nova sessão do Discord pela VPN...'
        $launchAt = Start-Discord
        $discordStarted = $true
        Write-Status 'Aguardando a nova sessão de rede do Discord...'
        if (-not (Wait-DiscordSession -StartedAfter $launchAt -TimeoutSeconds 75)) {
            throw 'O Discord não confirmou uma nova sessão iniciada pela VPN.'
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
            try { $null = Start-Discord; Write-Status 'Discord reaberto pela rota Brasil.' } catch {}
        }
        exit 1
    }
}

function Show-Gui {
    Add-Type -AssemblyName PresentationFramework,PresentationCore,WindowsBase
    [xml]$xaml = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        Title="LiveBrazil" Width="430" Height="250"
        WindowStartupLocation="CenterScreen" WindowStyle="None" ResizeMode="NoResize"
        AllowsTransparency="True" Background="Transparent" Foreground="#F2F3F5"
        ShowInTaskbar="False" Topmost="True">
  <Grid Margin="18">
    <Border Background="#1E1F22" BorderBrush="#3F4147" BorderThickness="1" CornerRadius="18" Padding="24">
      <Border.Effect>
        <DropShadowEffect Color="#000000" BlurRadius="24" ShadowDepth="6" Opacity="0.55"/>
      </Border.Effect>
      <Grid>
        <Grid.RowDefinitions>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
          <RowDefinition Height="Auto"/>
        </Grid.RowDefinitions>

        <Grid Grid.Row="0">
          <Grid.ColumnDefinitions><ColumnDefinition Width="Auto"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions>
          <Border Width="42" Height="42" Background="#111214" CornerRadius="21">
            <Image Name="AppIcon" Width="42" Height="42" Stretch="UniformToFill">
              <Image.Clip><EllipseGeometry Center="21,21" RadiusX="21" RadiusY="21"/></Image.Clip>
            </Image>
          </Border>
          <StackPanel Grid.Column="1" Margin="12,0,0,0" VerticalAlignment="Center">
            <StackPanel Orientation="Horizontal">
              <TextBlock Text="LiveBrazil" FontFamily="Segoe UI Variable Display, Segoe UI" FontSize="19" FontWeight="SemiBold"/>
              <Border Background="#23A55A" CornerRadius="8" Padding="7,2" Margin="10,2,0,0">
                <TextBlock Text="AUTOMÁTICO" Foreground="White" FontSize="9" FontWeight="Bold"/>
              </Border>
            </StackPanel>
            <TextBlock Text="Inicialização segura" Foreground="#949BA4" FontSize="10.5" Margin="0,3,0,0"/>
          </StackPanel>
          <Button Name="CloseButton" Grid.Column="2" Content="×" Visibility="Collapsed" Width="26" Height="26"
                  Background="Transparent" Foreground="#B5BAC1" BorderThickness="0" FontSize="18" Cursor="Hand"/>
        </Grid>

        <TextBlock Name="PhaseText" Grid.Row="1" Text="Preparando o ambiente..." Margin="0,18,0,0"
                   FontFamily="Segoe UI Variable Text, Segoe UI" FontSize="14" FontWeight="SemiBold"/>
        <TextBlock Name="DetailText" Grid.Row="2" Text="Aguarde enquanto iniciamos o Discord pela rota segura."
                   Margin="0,6,0,0" Foreground="#949BA4" FontSize="11.5" TextWrapping="Wrap"/>

        <ProgressBar Name="Progress" Grid.Row="3" Height="4" Margin="0,22,0,0" Minimum="0" Maximum="100" Value="18"
                     Background="#2B2D31" Foreground="#23A55A" BorderThickness="0">
          <ProgressBar.Template>
            <ControlTemplate TargetType="ProgressBar">
              <Grid Name="PART_Track" Height="4">
                <Border Background="{TemplateBinding Background}" CornerRadius="2"/>
                <Border Name="PART_Indicator" Background="{TemplateBinding Foreground}" CornerRadius="2" HorizontalAlignment="Left"/>
              </Grid>
            </ControlTemplate>
          </ProgressBar.Template>
        </ProgressBar>

        <Grid Grid.Row="4" Margin="0,14,0,0">
          <TextBlock Text="LiveBrazil  •  Discord Stable" Foreground="#6D6F78" FontSize="10.5" VerticalAlignment="Center"/>
          <Button Name="RetryButton" Content="Tentar novamente" Visibility="Collapsed" HorizontalAlignment="Right"
                  Padding="12,5" Background="#5865F2" Foreground="White" BorderThickness="0" FontSize="10.5"
                  FontWeight="SemiBold" Cursor="Hand"/>
        </Grid>
      </Grid>
    </Border>
  </Grid>
</Window>
'@
    $reader = New-Object System.Xml.XmlNodeReader $xaml
    $window = [Windows.Markup.XamlReader]::Load($reader)
    $appIcon = $window.FindName('AppIcon')
    $phaseText = $window.FindName('PhaseText')
    $detailText = $window.FindName('DetailText')
    $progress = $window.FindName('Progress')
    $retryButton = $window.FindName('RetryButton')
    $closeButton = $window.FindName('CloseButton')
    $iconPath = Join-Path $PSScriptRoot '6dae0b010e42f9fa0a59cb489c97ff32.png'
    if (Test-Path -LiteralPath $iconPath) {
        $bitmap = New-Object Windows.Media.Imaging.BitmapImage
        $bitmap.BeginInit()
        $bitmap.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        $bitmap.UriSource = [Uri]::new($iconPath, [UriKind]::Absolute)
        $bitmap.EndInit()
        $bitmap.Freeze()
        $appIcon.Source = $bitmap
    }
    $state = [pscustomobject]@{
        Child = $null
        Running = $false
        FinishedAt = $null
        ProgressValue = 18
    }

    $startWorkflow = {
        if ($state.Running) { return }
        try {
            $state.Running = $true
            $state.FinishedAt = $null
            $state.ProgressValue = 18
            $progress.Value = 18
            $progress.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#23A55A')
            $phaseText.Text = 'Solicitando permissão do Windows...'
            $detailText.Text = 'O LiveBrazil começará automaticamente após a confirmação.'
            $retryButton.Visibility = 'Collapsed'
            $closeButton.Visibility = 'Collapsed'
            New-Item -ItemType Directory -Path $StatusRoot -Force | Out-Null
            Set-Content -LiteralPath $StatusPath -Value 'Solicitando permissão do Windows...' -Encoding UTF8
            $arguments = '-NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "{0}" -Run' -f $PSCommandPath
            $state.Child = Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments -PassThru
        } catch {
            $state.Running = $false
            $state.Child = $null
            $progress.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#F23F42')
            $phaseText.Text = 'Não foi possível iniciar.'
            $detailText.Text = 'A permissão foi cancelada ou o Windows bloqueou a execução.'
            $retryButton.Visibility = 'Visible'
            $closeButton.Visibility = 'Visible'
        }
    }

    $timer = New-Object Windows.Threading.DispatcherTimer
    $timer.Interval = [TimeSpan]::FromMilliseconds(400)
    $timer.Add_Tick({
        if ($state.Running) {
            $state.ProgressValue += 3
            if ($state.ProgressValue -gt 90) { $state.ProgressValue = 24 }
            $progress.Value = $state.ProgressValue
            if (Test-Path -LiteralPath $StatusPath) {
                try {
                    $lines = [IO.File]::ReadAllLines($StatusPath, [Text.Encoding]::UTF8)
                    if ($lines.Count -gt 0) {
                        $message = $lines[$lines.Count - 1] -replace '^\d{2}:\d{2}:\d{2}\s+', ''
                        $phaseText.Text = $message
                    }
                } catch {}
            }
        }
        if ($state.Child -and $state.Child.HasExited) {
            $exitCode = $state.Child.ExitCode
            $state.Child.Dispose()
            $state.Child = $null
            $state.Running = $false
            if ($exitCode -eq 0) {
                $progress.Value = 100
                $progress.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#23A55A')
                $phaseText.Text = 'Tudo pronto.'
                $detailText.Text = 'Discord iniciado e conexão normal restaurada.'
                $state.FinishedAt = Get-Date
            } else {
                $progress.Value = 100
                $progress.Foreground = [Windows.Media.BrushConverter]::new().ConvertFromString('#F23F42')
                $phaseText.Text = 'Não foi possível concluir.'
                $detailText.Text = 'Confira o status em %LOCALAPPDATA%\LiveBrazil\status.log.'
                $retryButton.Visibility = 'Visible'
                $closeButton.Visibility = 'Visible'
            }
        }
        if ($state.FinishedAt -and ((Get-Date) - $state.FinishedAt).TotalSeconds -ge 2.5) {
            $window.Close()
        }
    })

    $launchTimer = New-Object Windows.Threading.DispatcherTimer
    $launchTimer.Interval = [TimeSpan]::FromMilliseconds(450)
    $launchTimer.Add_Tick({
        $launchTimer.Stop()
        & $startWorkflow
    })
    $retryButton.Add_Click({ & $startWorkflow })
    $closeButton.Add_Click({ $window.Close() })
    $window.Add_ContentRendered({ $launchTimer.Start() })
    $window.Add_Closed({ $launchTimer.Stop(); $timer.Stop() })
    $timer.Start()
    [void]$window.ShowDialog()
}

if ($Run) { Run-Workflow } else { Show-Gui }
