---
impacto: capacidade_nova
secao: adicionado
titulo: Cron "Palavra do Dia" para envio diário individualizado de versículo pelo WhatsApp
---

Organizações que atendem uma comunidade de fé (ex.: uma igreja digital) agora
podem configurar uma automation_rule com o gatilho `palavra_do_dia.pronta` para
mandar, uma vez por dia e no fuso da própria organização, um versículo
individualizado a cada membro ativo do funil.

O cron novo (`cron/palavra-do-dia`) busca o versículo do dia uma única vez por
organização — nunca por membro — e emite um evento por negócio; quem manda a
mensagem de verdade é a ação `send_whatsapp_message` já existente, então o
throttle anti-banimento, a janela de horário do canal e as guardas de contato
(bloqueado/consentimento) são os mesmos de qualquer outra automação.

A fonte do versículo é a API da YouVersion Platform, configurável por
`YOUVERSION_API_KEY`/`YOUVERSION_API_BASE_URL`/`YOUVERSION_BIBLE_ID`/
`YOUVERSION_VERSAO_LABEL` no `.env` — opcional, e sem efeito em quem não
configurar a automation_rule. Contrato verificado com chamada real contra a
API em 2026-09-21.
