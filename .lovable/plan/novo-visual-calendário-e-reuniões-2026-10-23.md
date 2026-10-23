# Novo visual: Calendário e Reuniões

Nada de integrações muda (Google Agenda, Gmail, Jira, CRM Angi, Outlook continuam iguais). Só o visual e a forma de navegar.

## Calendário — computador (anexo 1)
- Abre na **semana inteira (seg a dom)**, ocupando a tela toda, com rolagem para cima e para baixo nas horas; já abre rolada para a hora atual.
- **Linha vermelha da hora atual**.
- **Mini mês na lateral** (só aparece quando a aba Calendário está aberta): clicar num dia pula para a semana dele. Atalho **T** volta para hoje.
- Botões **Dia / Semana / Mês** + "Hoje" + setas no topo; filtro por empresa passa para o menu de visão.
- Botão "Sincronizar Google" vira um aviso discreto: "Google sincronizado há X min" (só alerta se der erro).
- **Mantidos como estão:** faixa "Sem data" e "Concluídos" com a seta em cima; o "done" que vai para baixo; cores (reunião vermelha, Angi verde etc.); edição rápida com lápis, arrastar e esticar.

## Calendário — iPhone (anexo 2)
- Estilo agenda do iPhone: mês no título, faixa da semana que desliza para o lado (pontinho colorido = tem compromisso).
- Abaixo, a **linha do tempo do dia com divisão por horário** e linha vermelha da hora atual, em vez da lista empilhada.
- Toque longo para mover; "Sem data" e "Concluídos" continuam no mesmo lugar.

## Reuniões (anexo 4)
- Computador em duas colunas: **lista à esquerda** agrupada por dia (Hoje, Segunda 26…), abas Próximas / Anteriores; **reunião aberta à direita**.
- Lado direito: empresa, título, horário, botão **"Entrar no Meet"** (quando houver link), contagem "em 35 min", pauta, participantes e **notas da reunião** (salvas automaticamente).
- **Próximos passos:** botão "Gerar com a IA a partir das notas" cria tarefas da empresa da reunião.
- Apagar mostra "Desfazer" por alguns segundos, em vez da caixa de confirmação.
- No iPhone: lista primeiro; tocar abre a reunião em tela cheia com botão voltar.

## Detalhes técnicos
- Reescrever a camada de visualização em `calendario.tsx` e `reunioes.tsx`, reaproveitando `fetchTasks`/`fetchMeetings`, modais existentes, `withAuthRetry`, sync Google e regras de cor.
- Pauta/participantes usam campos já existentes (notes/attendees) quando houver; notas reutilizam `meetings.notes` — sem mudar o banco, se possível.
- Barra lateral do app fica escondida/compacta só na rota do Calendário para dar espaço ao mini mês.
