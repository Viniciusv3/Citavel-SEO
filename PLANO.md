# Citavel (nome de trabalho) — diagnóstico SEO/AEO/GEO grátis + blog automático pago

> Documento vivo. **Só arquitetura e plano — nenhuma linha de código ainda.**
> "Citavel" é nome de trabalho (jogo com "citável", o próprio conceito de
> GEO) — trocar é só renomear a pasta e o doc, sem custo. Projeto irmão de
> `Converzia`, `GTA6` e `AutomaçãoYT`, cada um na própria pasta na área de
> trabalho (ver `CHECKPOINT.md` do repo `clickpage` pra visão dos 3+1
> projetos). Plano original nasceu em
> `clickpage/DOCS/FRENTE-3-SEO-AEO-GEO-PLANO.md` — este arquivo é a versão
> atualizada e definitiva, já com a decisão de virar app separado.

---

## 0. TL;DR

Ferramenta que recebe uma URL, diagnostica SEO/AEO/GEO (grátis, sem
cadastro) e devolve nota + problemas. Monetiza gerando automaticamente posts
de blog que corrigem os gaps encontrados — **e publicando esses posts no
site do próprio cliente, na estética dele**, não num blog nosso à parte.
Essa última parte (entrega) é o ponto mais delicado do produto e está
detalhada na seção 3.

---

## 1. Conceito — SEO / AEO / GEO na prática

- **SEO** (rankeamento Google clássico): técnico (crawlability, sitemap,
  robots.txt, Core Web Vitals, HTTPS, schema.org), on-page (title/meta,
  hierarquia H1-H6, alt text, links internos).
- **AEO** (Answer Engine): featured snippets, People Also Ask, FAQ schema,
  conteúdo em formato pergunta-resposta.
- **GEO** (Generative Engine): ser citado por LLMs (ChatGPT, Perplexity, AI
  Overview) — conteúdo citável, clareza factual, E-E-A-T, estrutura fácil de
  extrair por um modelo.

O diferencial real do produto é o ângulo GEO — SEO clássico já é dominado
por SEMrush/Ahrefs/Ubersuggest.

---

## 2. Diagnóstico grátis — pipeline técnico (sem mudança do plano original)

**Camada 1 — checks determinísticos** (sem IA): robots.txt/sitemap, title/
meta, hierarquia de headers, schema.org, HTTPS/canonical, Core Web Vitals
(PageSpeed Insights API, grátis), mobile-friendly, alt text, Open Graph.

**Camada 2 — leitura qualitativa via IA** (Haiku, barato): "esse conteúdo
responde perguntas diretamente?", "é citável por uma IA?", "que perguntas
óbvias do nicho ele não responde?" — aqui nasce a lista de gaps que vira
pauta de blog na Fase paga.

**Saída:** nota 0-100 compartilhável + lista de problemas com severidade.
Rate-limit por IP desde o dia 1 (a Camada 2 usa IA e sangra crédito sem
limite).

---

## 3. O ponto central: como o post aparece no site do cliente, na estética dele

Essa é a pergunta que decide se o produto funciona ou não. Existem 4 formas
de entregar o conteúdo, com trade-offs bem diferentes — **não são
mutuamente exclusivas, viram fases do roadmap**.

### 3.1 Exportação manual (o mais simples, primeiro a existir)
Geramos o post em Markdown/HTML pronto (título, meta description, corpo,
FAQ schema) e o cliente cola no CMS dele. **Zero engenharia de entrega**,
prova se as pessoas realmente querem os posts antes de investir em
integração. Fraqueza: quebra a promessa de "automático" — é semi-manual.

### 3.2 Integração nativa com CMS do cliente (o "gold standard")
Publicamos direto via API no CMS que o cliente já usa — o post nasce **no
tema dele**, zero trabalho de estética da nossa parte porque quem renderiza
é o site dele mesmo.
- **WordPress primeiro**: cobre a maior fatia de sites de pequenos negócios
  no Brasil, tem REST API bem documentada, e a autenticação é simples pro
  cliente (ele gera uma "Application Password" no próprio wp-admin e cola no
  nosso onboarding — sem precisar mexer em código).
- Depois, se fizer sentido pelo volume de clientes: Shopify (blog API),
  Webflow (CMS API), Wix (API mais limitada).
- **Se o cliente já é da Converzia**: controlamos a hospedagem dele — dá pra
  simplesmente adicionar `/blog/*` como rota nativa da própria página, sem
  integração nenhuma. Cross-sell direto e quase de graça de construir.

### 3.3 Proxy reverso sob o domínio do cliente (pra quem não tem CMS com API)
O post é renderizado nos nossos servidores, mas aparece em
`sitecliente.com/blog/post` (não num subdomínio nosso) porque o cliente
configura 1x um rewrite/worker que redireciona `/blog/*` pra gente — mesmo
padrão que ferramentas como Hashnode/Feather/Letterdrop usam.
- **Por que isso importa e não é só estética**: pro Google, conteúdo no
  mesmo domínio (mesmo que via proxy) conta pra autoridade do domínio
  principal do cliente. Conteúdo num **subdomínio nosso** (tipo
  `cliente.citavel.site`) é tratado com autoridade mais fraca e mais
  desconectada do domínio raiz — ironicamente prejudicial pra um produto que
  vende "melhorar seu SEO".
- Estética: onboarding captura cor primária/secundária, logo e fonte (igual
  o color picker da Converzia) — aproximação rápida. Versão mais fiel: o
  cliente cola um trecho do header/footer real do site dele e a gente
  envolve o post nisso — mais parecido com o site de verdade, mais trabalho
  de setup.
- Limitação real: setup técnico (mexer em rewrite/Cloudflare Worker) é difícil
  pra dono de negócio não-técnico — provavelmente exige um passo "façamos
  isso por você" no onboarding dos primeiros clientes, não self-service puro.

### 3.4 Hospedagem em subdomínio nosso (fallback simples)
`cliente.citavel.site` ou parecido, com tema configurável (cor/logo/fonte).
Mais fácil de construir que o proxy, mas com a fraqueza de SEO explicada em
3.3 — **usar só como fallback pra quem não consegue configurar proxy nem
tem CMS com API**, não como caminho principal.

### Recomendação de fases pra entrega
1. **Fase A (MVP pago)**: exportação manual (3.1) — valida demanda.
2. **Fase B**: integração nativa WordPress (3.2) — maior cobertura de
   mercado pelo menor esforço de engenharia, resolve a estética de graça.
3. **Fase C**: proxy reverso genérico (3.3) — cobre quem não é WordPress,
   com onboarding assistido no início.
4. **Fase D**: integração nativa com a própria Converzia — cross-sell quase
   gratuito quando o cliente já é dos dois lados.

---

## 4. Automação ponta a ponta (depois que o cliente contrata)

1. **Onboarding**: cliente informa a URL do site + escolhe modo de entrega
   (3.1 a 3.4) + credenciais mínimas se for CMS nativo (ex.: Application
   Password do WordPress) ou config de rewrite se for proxy.
2. **Pauta**: o diagnóstico (seção 2, Camada 2) já produziu a lista de gaps
   de conteúdo — perguntas do nicho que o site não responde. Isso vira a
   fila de pauta, sem precisar de nova pesquisa.
3. **Geração**: a cada N dias (config do cliente, ex.: 2 posts/semana), o
   sistema pega o próximo gap da fila e gera o post — Haiku extrai contexto
   do site/nicho, Sonnet escreve o post completo (título, meta description,
   corpo estruturado pra AEO/GEO, FAQ schema embutido). Mesmo padrão
   two-pass já validado na geração de páginas da Converzia.
4. **Fila de revisão** (opcional por plano): mesmo mecanismo já existente no
   hub do AutomaçãoYT (`needs_review` → aprovar/rejeitar antes de publicar).
   Plano básico pode publicar automático; plano com curadoria humana passa
   por aprovação manual.
5. **Publicação**: conforme o modo escolhido no onboarding (nativo/proxy/
   manual) — reaproveitando a mesma lógica de "publish" por canal que já
   existe no GTA6/hub (steps independentes por destino, falha num não
   derruba os outros).
6. **Agendamento**: mesmo padrão de `publishAt` já usado no YouTube do
   GTA6/hub — post pode sair na hora ou em horário programado, calculado a
   partir de "quantos posts, que intervalo".

---

## 5. Monetização (herdado do plano original, sem mudança)

Free: diagnóstico. Pago: geração + publicação automática dos posts.
**Pendência a resolver antes da Fase paga**: confirmar se o Asaas suporta
cobrança recorrente de verdade (hoje só há Pix avulso confirmado no
Converzia) — sem isso, vender pacote avulso de N posts em vez de assinatura.

---

## 6. Aquisição dos primeiros clientes (herdado, sem mudança)

1. Nota compartilhável como isca viral (score tipo "38/100 😬").
2. Reaproveitar `automacao-prospeccao/` do repo `clickpage`: achar leads com
   site ruim, rodar o diagnóstico automaticamente, usar o resultado como
   abertura no WhatsApp.
3. Parceria B2B2C com agências pequenas de marketing.
4. SEO do próprio produto pra "teste de SEO grátis".
5. Comunidades de nicho (grupos de e-commerce/agências PT-BR).

---

## 7. Decisões em aberto

- [ ] Nome definitivo (Citavel é só working name).
- [ ] Confirmar recorrência no Asaas (bloqueia Fase paga por assinatura).
- [ ] Qual modo de entrega vira o MVP pago de fato: manual (3.1) puro, ou já
      nascer com WordPress (3.2) por ser tão de alto impacto/baixo esforço?
- [ ] Profundidade do crawl no diagnóstico: só homepage ou +2/3 páginas.
- [ ] Quando entra na fila de execução — hoje Converzia (trial Railway),
      GTA6 e AutomaçãoYT têm prioridade (ver `CHECKPOINT.md` do `clickpage`).
