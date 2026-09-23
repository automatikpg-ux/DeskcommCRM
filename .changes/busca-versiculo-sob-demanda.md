---
impacto: capacidade_nova
secao: adicionado
titulo: Ferramenta "crm_search_bible_verse" para o agente buscar um versículo específico sob demanda
---

O agente agora pode responder "o que diz [livro] [capítulo]:[versículo]" com o
texto real do versículo, buscado na hora na API da YouVersion (a mesma fonte
já usada pela "Palavra do Dia", com o contrato já verificado contra a API
real). Antes disso o agente só tinha duas saídas ruins diante de uma
referência específica no meio da conversa: citar de memória (arriscando
inventar) ou sempre dizer que ia "confirmar com a equipe" — mesmo para um
versículo público que uma chamada resolveria na hora.

A ferramenta `crm_search_bible_verse` aceita o nome do livro em português (com
tolerância a acento, caixa e abreviação comum) mais capítulo e versículo, e
opcionalmente um versículo final para uma faixa curta dentro do mesmo
capítulo. Quando a referência não existe, devolve `encontrado: false` em vez
de erro — o agente é instruído a confirmar a referência com a pessoa em vez de
travar a conversa.

Opcional: sem `YOUVERSION_API_KEY` configurada nesta instalação, a ferramenta
devolve uma mensagem clara em vez de travar, e organizações que não
ativarem a capacidade na tela do agente não são afetadas.
