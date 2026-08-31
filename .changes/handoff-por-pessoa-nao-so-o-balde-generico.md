---
impacto: capacidade_nova
secao: adicionado
titulo: Handoff pode rotear direto para a etapa da pessoa, não só para o balde genérico
---

Antes, quando o cliente pedia para falar com alguém — ou o próprio agente
prometia "vou verificar com o Fernando" —, o card só tinha UM destino
automático por funil: a etapa marcada com o slug `chamar-humano`. Uma
organização que já nomeia a pessoa/setor no próprio funil (ex.: "Repassado
para o Fernando") via o card cair sempre no balde genérico, e alguém
precisava movê-lo na mão de novo para a etapa certa.

Agora, qualquer etapa pode reivindicar uma ou mais palavras em
"Palavras-chave de handoff" (mesmo formato da lista de palavras do agente:
substring, sem diferenciar maiúsculas/minúsculas). Quando o texto que
disparou o handoff contém uma dessas palavras, o lead vai direto para
aquela etapa; só quando nenhuma etapa reivindica a palavra é que o card cai
no destino genérico de sempre. É opt-in e aditivo — etapa sem palavra
nenhuma continua se comportando exatamente como antes.
