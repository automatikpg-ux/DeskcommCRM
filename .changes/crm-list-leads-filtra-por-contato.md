---
impacto: capacidade_nova
secao: adicionado
titulo: Ferramenta crm_list_leads agora filtra por contato
---

Um agente de atendimento que recebe uma mensagem só sabe o `contact_id` de
quem está falando — nunca o `lead_id` de um negócio do funil. Sem um jeito de
achar "o negócio deste cliente" a partir do contato, um agente não tinha como
responder perguntas que dependem da etapa atual do lead (ex.: "meu serviço já
está pronto?"), mesmo com essa informação já registrada no CRM.

`crm_list_leads` ganha o filtro opcional `contact_id`. Não muda nada para
quem não usa o parâmetro novo — todo comportamento existente (paginação,
demais filtros) continua igual.
