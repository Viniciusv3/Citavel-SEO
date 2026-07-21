# Citavel — protótipo funcional (todas as fases)

Diagnóstico SEO / AEO / GEO grátis + geração e publicação automática de posts.
Implementa as Fases A, B e C/3.4 do [PLANO.md](PLANO.md) e a automação da seção 4.

## Como rodar

```bash
cd app
npm install   # só na primeira vez
npm start     # sobe em http://localhost:3000
```

## Mapa do app

| URL | O que é |
|---|---|
| `/` | **Diagnóstico** — nota 0-100, 27 checks, pauta automática |
| `/kit.html?url=…` | **Kit de Correção** — meta tags, schema.org, robots.txt, llms.txt e FAQ schema prontos para colar |
| `/post.html?url=…&gap=…` | **Post avulso** — preview + exportar Markdown/HTML (Fase A) |
| `/painel.html` | **Painel** — clientes, fila de pauta, revisão, entrega, agendamento e piloto automático |
| `/b/:clienteId` | **Blog hospedado** do cliente, no tema dele (Fase C/3.4) |
| `/landing.html` | Landing page do produto |
| `/apresentacao.html` | Apresentação em 9 slides (← →) |

## O diagnóstico (grátis — a isca)

27 checks determinísticos em SEO (HTTPS, noindex, robots, sitemap, title, meta,
H1, canonical, mobile, conteúdo misto, alt, idioma, OG, páginas internas), AEO
(schema.org, FAQ schema, página de FAQ, títulos-pergunta, listas/tabelas,
perguntas comerciais) e GEO (blog, substância, E-E-A-T, datas, copyright,
**llms.txt**, peso do HTML, conteúdo dependente de JS). Régua calibrada para
venda: avisos valem 30% e erros críticos põem teto na nota. Rate-limit por IP.

## As soluções (a parte paga, toda funcional)

**1. Pauta → Post (Fase A, exportação manual).** Cada gap vira um post completo:
título, meta description, corpo com H2-pergunta, FAQ com FAQPage schema (JSON-LD).
Dois motores em [generator.js](app/generator.js): template determinístico (padrão,
marca `[PREENCHA]` no que só o dono sabe) e IA two-pass Haiku→Sonnet (liga sozinho
com `ANTHROPIC_API_KEY` no ambiente).

**2. Kit de Correção técnica** ([kit.js](app/kit.js)): o que blog não resolve —
meta tags, JSON-LD LocalBusiness, robots.txt com crawlers de IA liberados,
llms.txt e FAQ schema, tudo personalizado com os dados reais do site e
priorizado pelos checks que falharam.

**3. Painel + automação (seção 4 do plano)** — [painel.html](app/public/painel.html):
- Cliente criado pela URL → diagnóstico vira fila de pauta automaticamente
- Fila de revisão (`needs_review` → aprovar / aprovar e agendar / rejeitar;
  rejeitar devolve a pauta à fila)
- **Agendamento** (`publishAt`) e **piloto automático** (gera + publica a cada N
  dias) via scheduler que roda a cada minuto
- Persistência em `app/data.json` (MVP local)

**4. Entrega por canal** ([publisher.js](app/publisher.js)):
- **3.1 Manual** — copiar MD/HTML direto do painel
- **3.2 WordPress (Fase B)** — publica via REST API com Application Password;
  botão "Testar conexão" no painel. Pronto para o primeiro cliente real.
- **3.3/3.4 Blog hospedado** — posts servidos em `/b/:id/:slug` com as cores do
  cliente + snippet de Cloudflare Worker gerado para o proxy reverso
  (`sitecliente.com/blog/*` → autoridade SEO no domínio dele)

## Motor de IA (opcional)

```bash
set ANTHROPIC_API_KEY=sk-ant-...   # Windows cmd — ou variável de ambiente
npm start
```

Sem chave, tudo funciona com o motor de template. Com chave, os posts saem
escritos por IA (Haiku extrai o contexto do site, Sonnet escreve — seção 4.3).

## O que falta (decisões externas)

- Cobrança: confirmar recorrência no Asaas (seção 5)
- Testar a publicação WordPress contra um site real do primeiro cliente
- Deploy público (o blog hospedado/proxy precisa de uma URL pública)
- Nome definitivo
