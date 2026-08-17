[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$c = Get-Content 'E:\qt_projects_resume\kid_english_game\public\js\levels.js' -Raw -Encoding UTF8
$i = $c.IndexOf('getLevel(')
$c.Substring([Math]::Max(0, $i - 200), 2400)
