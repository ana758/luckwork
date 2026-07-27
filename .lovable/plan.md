# Auditoria da Anora — o que falta e o que melhorar

Sua plataforma já tem todas as áreas que você pediu (Dashboard, Tarefas, Calendário, Reuniões, IA, Ajustes), sincroniza com Jira/Notion/Google e a IA cria/apaga/classifica. Mas a promessa central — **"me lembre sempre de tudo"** — hoje só funciona com o app aberto. Segue o diagnóstico e o que proponho fazer.

---

## O que já está OK ✅

- Dashboard por empresa, gráfico redondo semanal, tarefas atrasadas.
- Jira ↔ Anora (filtrado por Ana Duque).
- Notion ↔ Anora (só DAILY GESTÃO + Content Pipeline).
- Google Agenda bilateral (multi-conta, com Google Meet automático).
- Brand.Pe manual (sem sync — como pedido).
- IA: cria/apaga tarefas por texto, resume reuniões, aprende classificação por título.
- Reuniões com convidados, recorrência, seleção em massa.

---

## O que falta ou está frágil ⚠️

### 1. Lembretes só funcionam com o app aberto (crítico)
Hoje tudo (sync, notificação 30min antes, lembrete de tarefa atrasada, resumo do dia) roda **no navegador** via `setInterval`. Se o iPhone bloqueia, se o Safari fecha, se você não abriu hoje — **nada dispara**.

### 2. Sem e-mail nem WhatsApp
Você pediu alerta por e-mail/WhatsApp de atraso — não existe. Só existe notificação in-app.

### 3. Resumo diário não é automático
Só aparece quando você entra na aba IA e pede. Não chega de manhã sozinho.

### 4. Risco de apagar reunião válida
Se o Google Agenda falhar por segundos durante o sync, a rotina de limpeza pode marcar reuniões reais como "órfãs" e apagá-las.

### 5. IA apaga sem confirmar
Se você disser "apaga a reunião com X" e houver 2-3 candidatas, ela apaga direto a primeira sem confirmar.

### 6. Falhas silenciosas
Quando o push para Jira/Notion/Google falha, a Anora não avisa — parece que salvou, mas o outro sistema ficou sem.

### 7. Duas abas abertas = tudo em dobro
Sem trava global; múltiplas abas duplicam chamadas às APIs (custo e risco de corrida).

---

## Plano de melhorias (por prioridade)

### Fase A — Lembretes que funcionam de verdade (P0)
1. **Cron no servidor** (`pg_cron` + rota `/api/public/hooks/*`) rodando a cada 5 min mesmo com app fechado:
   - Sincroniza Jira/Notion/Google.
   - Detecta reuniões nos próximos 30 min e tarefas vencidas.
2. **Web Push real** (Service Worker + VAPID): notificação chega no iPhone/desktop mesmo com Safari fechado (requer PWA instalada — já está).
3. **Resumo diário automático** às 8h da manhã via cron, gerado pela mesma IA e entregue por push.

### Fase B — E-mail e WhatsApp (P0)
4. **E-mail via Resend** (connector Lovable): resumo diário + alerta de reunião + tarefas atrasadas para ana@devoresnacks.com.
5. **WhatsApp**: preciso saber sua preferência — Twilio (pago, imediato) ou WhatsApp Business API oficial (mais barato, requer aprovação Meta).

### Fase C — Robustez (P1)
6. Isolar erro por conta no sync do Google (não apaga órfão se a conta falhou).
7. Trava distribuída no Postgres para evitar sync duplicado entre abas/dispositivos.
8. Tabela `sync_log` para você ver na aba Ajustes quando algo falhou.
9. Feedback visível quando push para Jira/Notion falha (toast + badge no card).

### Fase D — Polimento (P2)
10. IA pede confirmação quando delete tem múltiplos candidatos.
11. Otimizar reclassificação retroativa (hoje escaneia tudo a cada 3 min).
12. Monitor de expiração dos tokens (Jira, Notion, Google) com aviso no app antes de quebrar.

---

## Perguntas antes de eu começar

Para eu não implementar tudo de uma vez (fica caro em créditos e demora), me diga:

1. **Começo pela Fase A?** (é a que resolve "me lembre sempre" — sem ela, o resto pouco importa).
2. **WhatsApp: Twilio ou pulo por enquanto** e faço só e-mail?
3. **Alguma das outras fases é urgente** ou faço em ordem?

Assim que você responder, transformo isto em execução.