## Objetivo

Um hub único, clean e intuitivo (bom no celular e no computador) para gerenciar pendências da Angi, Devore, Bruna e Pessoal, com cores fixas por origem.

Fase 1 = app completo funcionando com dados reais salvos na nuvem do Lovable. Fase 2 = ligar Google Agenda/Gmail, Outlook, Notion (Devore), Jira e CRM Angi.

## Código de cores (global)

- Angi — verde
- Devore — azul
- Bruna — roxo
- Pessoal — rosa
- Reunião — vermelho (tipo de item, sobrepõe)

Resto neutro/clean: fundo claro, tipografia simples, cor só em marcadores, bordas e badges.

## Login e contas de e-mail

**1. Entrar no sistema** — e-mail/senha + entrar com Google.
- Contas iniciais: ana@devoresnacks.com e anaduquek@gmail.com — as duas caem no mesmo espaço de trabalho.
- Um e-mail novo entra como "aguardando aprovação" e você libera em Configurações → Acessos.

**2. Caixas de e-mail conectadas (leitura para IA e reuniões)**
- ana@devoresnacks.com (Google), anaduquek@gmail.com (Google), biduque@hotmail.com (Outlook), + botão "Adicionar outra conta".

## Páginas

### 1. Início (Dashboard)

**Barra "Hoje"** no topo: tudo do dia numa lista só (tarefas que vencem, atrasadas e reuniões), com cor por empresa.

**4 cartões pequenos** (Angi, Devore, Bruna, Pessoal), cada um com:
- número de pendências e de atrasados;
- atalhos clicáveis com o nome do sistema (Jira, CRM Angi, Notion, Google Agenda) — clicou, abre direto;
- botão "Acessos" que abre uma gaveta lateral com a lista de links, login e senha daquele grupo, com botão de copiar e olhinho para revelar a senha. Você adiciona/edita quantos quiser ali mesmo;
- quando a integração real estiver ligada, o atalho ganha uma marca "Conectado" e não precisa mais de senha.

**Gráfico redondo (donut)** da semana: concluídas, em andamento, não iniciadas.

### 2. Tarefas
- Alternador Lista / Board (kanban) e Semanal / Mensal.
- Colunas: A fazer, Em andamento, On hold, Concluída.
- Cada tarefa: título, empresa (cor), data início, data fim, última atualização, prioridade (alta/média/baixa), origem e link para o item original.
- Recorrentes (diária/semanal/mensal): regra cadastrada uma vez; na visão semanal aparece só a ocorrência da semana.
- Só aparecem tarefas atribuídas a você.

### 3. Calendário
- Visão mensal com tarefas e reuniões coloridas por empresa.
- Na fase 2, espelha para o Google Agenda.

### 4. Reuniões
- Lista das reuniões (vermelho) com tipo, participantes e anotações.
- Na fase 2, notas recebidas por e-mail entram automaticamente vinculadas.

### 5. Espaço AI
- Resumo do dia: atrasados, vencimentos, reuniões.
- Sugestões quando uma tarefa está arrastando.
- Na fase 2, análise dos e-mails para gerar pendências e avisos.

### 6. Configurações
- Acessos de login (aprovar e-mails), contas conectadas, todos os links e senhas em um só lugar, preferências de alerta.

## Facilitadores (novos)

- **Botão "+" fixo** em todas as páginas: cria tarefa ou reunião com 3 campos (o quê, quando, qual empresa). O resto é opcional.
- **Barra "Hoje"** no dashboard, descrita acima.

## Alertas de atraso

- Notificação dentro do sistema (sempre).
- E-mail (precisa de um domínio seu para envio — configuramos junto).
- WhatsApp fica de fora por enquanto (não há caminho gratuito confiável).

Verificação automática algumas vezes ao dia.

## Regras de sincronização (fase 2)

- Empresa → seu app: só entra se seu nome estiver marcado.
- Seu app → empresa: só sai se você marcar a empresa na tarefa.
- Marcado como Pessoal → só o Google Agenda.
- Bilateral: concluir aqui conclui lá, com aviso visível se a atualização falhar.

## Ordem das integrações (fase 2)

1. Google Agenda + Gmail
2. Outlook/Hotmail
3. Notion (Devore)
4. Jira (Angi)
5. CRM Angi (depende de API; se não houver, atalho + tarefas manuais)

## Detalhes técnicos

- Lovable Cloud (banco + login + funções de servidor) com RLS.
- `workspace_members` com status active/pending para o fluxo de aprovação.
- Tabelas: `profiles`, `workspace_members`, `sources`, `tasks`, `task_recurrences`, `task_occurrences`, `meetings`, `meeting_notes`, `email_accounts`, `integration_accounts`, `sync_log`, `notifications`, `alerts_sent`, `access_entries` (link + login + senha, senha criptografada no servidor e só revelada sob demanda).
- Rotas: `/` (dashboard), `/tarefas`, `/calendario`, `/reunioes`, `/ai`, `/auth`, `/configuracoes`.
- Cores como tokens semânticos em `src/styles.css`.
- Donut com Recharts; kanban com drag-and-drop leve; IA via Lovable AI.

## Fora do escopo agora

WhatsApp, relatórios avançados, equipes com permissões diferentes.
