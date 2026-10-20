# CRM Angi
- [x] Corrigir importação para início e prazo final separados, sem data do update.
- [x] Uniformizar compromissos existentes em um único dia e corrigir Rafael Aspen para 03/11.
- [ ] Reconciliar todas as datas e prazos finais: bloqueado porque CRM envia somente `when`, sem campos separados de início e prazo final. O remetente precisa enviar `interaction.start_date` e `interaction.due_date`.
- [x] Testar as regras; agenda abre autenticada. Confirmar Rafael em novembro.