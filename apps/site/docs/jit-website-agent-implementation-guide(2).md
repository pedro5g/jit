# JIT Website — Guia de implementação com Next.js

> Documento operacional para implementar a landing page, a documentação, os benchmarks e o playground da JIT.  
> Deve ser utilizado junto de `jit-design-system.md`.  
> Stack oficial: **Next.js App Router + Fumadocs + Tailwind CSS 4 + Motion**.

---

# 1. Decisão arquitetural

A implementação deve usar Next.js porque:

- é a stack de maior familiaridade da equipe;
- reduz o custo de manutenção e onboarding;
- permite manter landing, documentação, API reference, blog e playground no mesmo projeto;
- fornece Metadata API, geração de sitemap, robots, Open Graph, JSON-LD, imagens e fontes;
- permite Server Components por padrão;
- permite pré-renderizar as páginas públicas;
- oferece uma rota clara para recursos dinâmicos futuros.

A troca de Next.js por Next.js não autoriza transformar o site em uma aplicação totalmente client-side.

A arquitetura correta é:

```text
Server Components por padrão
        ↓
HTML pré-renderizado e indexável
        ↓
Client Components pequenos nas folhas
        ↓
Motion somente onde há interação real
```

---

# 2. Stack oficial

## 2.1. Core

- Next.js App Router;
- React;
- TypeScript strict;
- Node.js em versão suportada pela release atual do Next.js e do Fumadocs;
- pnpm no monorepo;
- Server Components como padrão.

## 2.2. Documentação

- Fumadocs Core;
- Fumadocs UI;
- Fumadocs MDX;
- Orama static client ou FlexSearch static para busca local;
- MDX para páginas técnicas;
- geração de API reference a partir do código, quando possível.

O Fumadocs oferece layouts, TOC, sidebar, search, source API e componentes de documentação sem exigir que a identidade visual seja abandonada.

## 2.3. Estilos

- Tailwind CSS 4 para integração com Fumadocs UI;
- CSS custom properties como fonte de verdade dos tokens;
- arquivos CSS globais para foundations;
- CSS Modules quando um componente possuir geometria complexa;
- nenhuma solução CSS-in-JS com runtime.

Tailwind não deve substituir o design system. Os tokens são definidos em CSS e expostos ao Tailwind.

## 2.4. Motion

- CSS animations para sprites, hover e microestados;
- `motion/react` para springs e sequências;
- Web Animations API quando uma dependência não for necessária;
- IntersectionObserver para ativação por viewport;
- `requestAnimationFrame` ou Motion values para pointer tracking.

## 2.5. Conteúdo

- Fumadocs MDX;
- arquivos de conteúdo versionados no repositório;
- snippets importados de arquivos TypeScript reais;
- dados de benchmark gerados no build;
- frontmatter validado.

## 2.6. Testes e qualidade

- Lighthouse CI;
- Biome;
- TypeScript;
- checker de links;
- validação de snippets.

---

# 3. Versões e compatibilidade

No início da implementação:

1. consultar a documentação atual do Next.js;
2. consultar a versão atual do Fumadocs;
3. instalar versões mutuamente compatíveis;
4. fixar o lockfile;
5. registrar a decisão em um ADR.

Na revisão deste documento, a instalação manual atual do Fumadocs para Next.js usa Next.js 16 e Tailwind CSS 4. Não codificar números de versão no conteúdo público sem necessidade.

---

# 4. Estratégia de renderização

## 4.1. Páginas públicas

Landing, docs, API reference, benchmarks, changelog e artigos devem ser:

- pré-renderizados;
- compartilhados entre usuários;
- servidos a partir de cache;
- indexáveis sem executar JavaScript;
- funcionais sem hidratação.

## 4.2. Server Components

Devem ser Server Components:

- layouts;
- header estrutural;
- footer;
- conteúdo MDX;
- code blocks;
- tabelas;
- benchmark summaries;
- cards;
- metadata;
- JSON-LD;
- breadcrumbs;
- sidebar data;
- TOC data;
- Open Graph data;
- páginas de compatibilidade;
- changelog;
- páginas de API.

## 4.3. Client Components

Usar `"use client"` somente nos componentes-folha:

- mascote interativo;
- busca;
- copy button;
- tabs com estado;
- playground;
- benchmark filters;
- chart interativo;
- controle de motion;
- menu mobile quando necessário;
- feedback visual local.

Não colocar `"use client"` em:

- root layout;
- layout da landing;
- layout completo das docs;
- página inteira;
- grandes árvores de conteúdo.

## 4.4. Static export

`output: "export"` é opcional, não a arquitetura principal.

Usar somente se houver exigência de hospedagem sem runtime Node. Antes de ativar, validar as limitações:

- sem Server Actions;
- sem recursos dependentes da request;
- sem redirects e headers do runtime;
- sem ISR;
- sem image loader padrão em runtime;
- rotas dinâmicas precisam ser conhecidas no build;
- busca precisa usar índice estático ou serviço externo.

A opção recomendada para o projeto é deploy Next.js normal com páginas públicas estáticas.

---

# 5. Instalação inicial

Exemplo conceitual:

```bash
pnpm create next-app@latest apps/site
cd apps/site

pnpm add fumadocs-core fumadocs-ui fumadocs-mdx
pnpm add motion
pnpm add clsx tailwind-merge
pnpm add lucide-react

pnpm add -D tailwindcss @tailwindcss/postcss
pnpm add -D @lhci/cli
pnpm add -D @biomejs/biome
```

Regras:

- confirmar os comandos na documentação atual;
- não instalar biblioteca de state management para o mascote sem necessidade;
- não adicionar biblioteca de carrossel antes de existir um caso real;
- preferir APIs do navegador;
- usar o menor pacote do Motion que atender a necessidade;
- evitar pacotes de syntax highlighting duplicados.

---

# 6. Estrutura do projeto

```text
apps/site/
├── app/
│   ├── (marketing)/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── benchmarks/
│   │   │   ├── page.tsx
│   │   │   ├── methodology/
│   │   │   │   └── page.tsx
│   │   │   └── [suite]/
│   │   │       └── page.tsx
│   │   ├── playground/
│   │   │   └── page.tsx
│   │   ├── changelog/
│   │   │   └── page.tsx
│   │   └── blog/
│   │       ├── page.tsx
│   │       └── [slug]/
│   │           └── page.tsx
│   ├── docs/
│   │   ├── layout.tsx
│   │   └── [[...slug]]/
│   │       └── page.tsx
│   ├── api-reference/
│   │   └── [[...slug]]/
│   │       └── page.tsx
│   ├── api/
│   │   ├── search/
│   │   │   └── route.ts
│   │   └── og/
│   │       └── route.tsx
│   ├── opengraph-image.tsx
│   ├── twitter-image.tsx
│   ├── sitemap.ts
│   ├── robots.ts
│   ├── manifest.ts
│   ├── not-found.tsx
│   ├── global-error.tsx
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── brand/
│   │   ├── jit-logo.tsx
│   │   ├── jit-ghost-static.tsx
│   │   ├── jit-ghost-interactive.tsx
│   │   ├── jit-ghost-loader.tsx
│   │   └── pixel-icon.tsx
│   ├── code/
│   │   ├── code-panel.tsx
│   │   ├── code-diff.tsx
│   │   ├── copy-button.tsx
│   │   └── generated-code.tsx
│   ├── compiler/
│   │   ├── compiler-demo.tsx
│   │   ├── compiler-demo-client.tsx
│   │   ├── compiler-pipeline.tsx
│   │   ├── operation-tabs.tsx
│   │   └── pass-card.tsx
│   ├── benchmark/
│   │   ├── benchmark-chart.tsx
│   │   ├── benchmark-chart-client.tsx
│   │   ├── benchmark-table.tsx
│   │   └── environment-card.tsx
│   ├── landing/
│   │   ├── hero.tsx
│   │   ├── proof-strip.tsx
│   │   ├── specialization-section.tsx
│   │   ├── codegen-section.tsx
│   │   ├── compilation-modes-section.tsx
│   │   ├── optimizer-section.tsx
│   │   ├── benchmarks-section.tsx
│   │   └── final-cta.tsx
│   ├── docs/
│   ├── seo/
│   │   ├── json-ld.tsx
│   │   └── metadata.ts
│   └── ui/
├── content/
│   ├── docs/
│   ├── blog/
│   ├── changelog/
│   └── api/
├── lib/
│   ├── source.ts
│   ├── metadata.ts
│   ├── seo/
│   │   ├── canonical.ts
│   │   ├── json-ld.ts
│   │   └── social.ts
│   ├── ghost/
│   │   ├── events.ts
│   │   ├── machine.ts
│   │   ├── motion.ts
│   │   ├── preferences.ts
│   │   └── safe-areas.ts
│   ├── benchmarks/
│   ├── snippets/
│   └── performance/
├── public/
│   ├── brand/
│   ├── fonts/
│   ├── icons/
│   ├── images/
│   ├── og/
│   └── sprites/
│       └── jit-ghost/
├── scripts/
│   ├── generate-api-reference.ts
│   ├── generate-benchmark-data.ts
│   ├── generate-og-assets.ts
│   ├── validate-snippets.ts
│   └── check-links.ts
├── mdx-components.tsx
├── source.config.ts
├── next.config.ts
├── postcss.config.mjs
├── tsconfig.json
└── package.json
```

---

# 7. Configuração Next.js

Exemplo inicial:

```ts
import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  experimental: {
    optimizePackageImports: ["lucide-react", "motion"],
  },

  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default withMDX(nextConfig);
```

Regras:

- confirmar o nome e a estabilidade das opções na versão instalada;
- não ativar flags experimentais sem benefício medido;
- não ativar `output: "export"` no perfil principal;
- não marcar o site inteiro como dinâmico;
- não desabilitar image optimization por conveniência.

---

# 8. Root layout

O root layout deve permanecer Server Component.

```tsx
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL!),
  title: {
    default: "JIT",
    template: "%s | JIT",
  },
  description: "Descrição pública validada da biblioteca JIT.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#151822",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
```

Não incluir providers globais sem necessidade.

---

# 9. Fumadocs

## 9.1. Source configuration

Exemplo conceitual:

```ts
import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});
```

## 9.2. Source loader

```ts
import { loader } from "fumadocs-core/source";
import { docs } from "@/.source";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});
```

## 9.3. Docs route

```tsx
import { notFound } from "next/navigation";
import { source } from "@/lib/source";

export function generateStaticParams() {
  return source.generateParams();
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <article>
      <h1>{page.data.title}</h1>
      <MDX />
    </article>
  );
}
```

Adaptar à API real da versão instalada.

## 9.4. Search

Preferência inicial:

- Orama static client;
- índice gerado no build;
- busca local;
- sem Route Handler quando o perfil estático for desejado.

Migrar para serviço externo somente se:

- o corpus crescer significativamente;
- relevância e analytics justificarem;
- o custo operacional for aceitável.

---

# 10. Tailwind e tokens

O design system é definido primeiro em CSS:

```css
@import "tailwindcss";
@import "fumadocs-ui/css/neutral.css";
@import "fumadocs-ui/css/preset.css";

:root {
  --jit-bg: #151822;
  --jit-bg-deep: #0d1018;
  --jit-surface: #23292f;
  --jit-surface-raised: #2f373c;

  --jit-text: #f3efd1;
  --jit-text-muted: #aeb2b3;

  --jit-ghost: #ddd9b5;
  --jit-gold: #f7d27e;
  --jit-gold-strong: #e8bb5e;

  --jit-border: rgba(221, 217, 181, 0.1);
}

@theme inline {
  --color-jit-bg: var(--jit-bg);
  --color-jit-surface: var(--jit-surface);
  --color-jit-text: var(--jit-text);
  --color-jit-ghost: var(--jit-ghost);
  --color-jit-gold: var(--jit-gold);

  --font-sans: var(--font-inter);
  --font-mono: var(--font-mono);
}
```

Regras:

- não espalhar hex values em componentes;
- não reproduzir todos os tokens como classes arbitrárias;
- usar classes semânticas para componentes complexos;
- manter pixel geometry em CSS Module quando necessário.

---

# 11. Fontes

## 11.1. Inter e JetBrains Mono

Usar `next/font`.

Benefícios:

- self-host automático;
- redução de requests externos;
- métricas ajustadas;
- menor risco de layout shift.

## 11.2. Fonte pixel

Usar `next/font/local`.

```ts
import localFont from "next/font/local";

export const pixelFont = localFont({
  src: "../public/fonts/pixel.woff2",
  variable: "--font-pixel",
  display: "swap",
  preload: false,
});
```

Não pré-carregar a fonte pixel se ela não for usada acima da dobra.

---

# 12. Imagens e sprites

## 12.1. `next/image`

Usar para:

- logo raster;
- screenshots;
- diagramas;
- imagens editoriais;
- Open Graph previews dentro da página.

Definir sempre:

- `width`;
- `height`;
- `sizes`;
- `priority` somente no LCP;
- `alt`.

## 12.2. Pixel art

Para sprites:

- arquivo em `public/sprites`;
- `image-rendering: pixelated`;
- escala por múltiplo inteiro;
- dimensões explícitas;
- WebP lossless ou PNG indexado;
- não usar transformação de imagem que suavize o sprite.

## 12.3. Static export

Se `output: "export"` for usado:

- configurar loader próprio;
- ou usar assets já otimizados;
- não assumir o funcionamento do loader padrão.

---

# 13. Landing page

## 13.1. Ordem

```text
Header
Hero
Proof strip
Why specialization
Schema → IR → generated code
Runtime JIT versus OAT
Operations
Optimizer pipeline
Benchmarks
Developer experience
Runtime compatibility
Playground CTA
Documentation CTA
Community
Footer
```

## 13.2. Hero

Server-rendered:

- eyebrow;
- headline;
- description;
- install command;
- CTAs;
- fallback estático do terminal;
- fallback estático do mascote.

Client enhancement:

- sequência de compilação;
- pointer tracking;
- partículas;
- tabs da demo;
- pequenas transições.

Não esconder o texto atrás da animação.

## 13.3. Compiler demo

A página deve enviar HTML real para:

- schema;
- generated code;
- título;
- explicação;
- links.

A versão interativa é carregada dinamicamente.

```tsx
import dynamic from "next/dynamic";

const CompilerDemoClient = dynamic(() => import("./compiler-demo-client"), {
  loading: () => <CompilerDemoSkeleton />,
});
```

Quando o componente depender de browser APIs, colocar o dynamic import dentro de um Client Component pequeno.

---

# 14. Mascote

## 14.1. Divisão de componentes

```text
JitGhostStatic
    ↓
HTML/SVG/Sprite renderizado no servidor

JitGhostLoader
    ↓
Client Component pequeno, decide quando ativar

JitGhostInteractive
    ↓
Motion, pointer, state machine e eventos
```

## 14.2. Não hidratar no primeiro paint

Estratégia:

1. renderizar pose estática;
2. aguardar viewport ou idle;
3. verificar reduced motion;
4. verificar pointer type;
5. carregar módulo interativo;
6. substituir sem alterar dimensões.

## 14.3. Estado

```ts
export type JitGhostState =
  | "hidden"
  | "entering"
  | "idle"
  | "observing"
  | "following"
  | "pointing"
  | "reading"
  | "typing"
  | "compiling"
  | "optimizing"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "sleeping"
  | "leaving";
```

## 14.4. Eventos

```ts
export type GhostEventMap = {
  "section:enter": { id: string };
  "section:leave": { id: string };
  "code:copied": { id: string };
  "compile:start": { operation: string };
  "compile:success": { operation: string; duration: number };
  "compile:error": { operation: string };
  "benchmark:start": { suite: string };
  "benchmark:finish": { suite: string };
};
```

## 14.5. Pointer tracking

Não usar React state a cada `pointermove`.

Usar:

- Motion values;
- CSS variables;
- ref;
- `requestAnimationFrame`;
- transform;
- throttling por frame.

## 14.6. Preferências

Persistir:

```text
jit:motion-preference
jit:ghost-visible
jit:ghost-intro-seen
```

O controle deve oferecer:

- Full motion;
- Reduced motion;
- Hide mascot.

---

# 15. Motion

## 15.1. Client boundary

Importar Motion somente nos componentes que animam.

Não importar `motion/react` em:

- layout;
- MDX root;
- header estrutural;
- todos os cards;
- páginas de documentação.

## 15.2. Lazy Motion

Avaliar `LazyMotion` e feature bundles menores quando houver ganho real.

## 15.3. Scroll

Usar:

- IntersectionObserver;
- Motion `useInView`;
- CSS scroll-driven animation quando suportado;
- fallback estático.

Não usar:

- scroll hijacking;
- pinning extenso;
- listeners globais que leem layout a cada frame.

## 15.4. Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  [data-decorative-motion] {
    animation: none !important;
    transition: none !important;
  }
}
```

Feedback funcional continua existindo sem movimento intenso.

---

# 16. Playground

## 16.1. Rota separada

`/playground` não pertence ao critical path da landing.

## 16.2. Carregamento

- shell e explicação como Server Component;
- editor e runtime como Client Component dinâmico;
- worker para compilação e execução;
- loading skeleton com dimensões fixas.

## 16.3. Segurança

- não executar código arbitrário no servidor;
- não permitir imports remotos sem controle;
- timeout;
- limite de memória possível;
- worker terminável;
- CSP;
- validação de mensagens;
- não registrar código do usuário em analytics.

## 16.4. URLs compartilháveis

- codificar estado pequeno;
- comprimir quando necessário;
- `noindex` em estados infinitos;
- canonical para a rota base.

---

# 17. Benchmarks

## 17.1. Build-time data

O pipeline deve gerar JSON versionado.

```ts
export interface BenchmarkResult {
  suite: string;
  case: string;
  implementation: string;
  value: number;
  unit: "ps" | "ns" | "µs" | "ms" | "ops/s";
  lowerIsBetter: boolean;
  runtime: string;
  cpu: string;
  os: string;
  commit: string;
  date: string;
  samples: number;
}
```

## 17.2. Renderização

Server Component:

- título;
- metodologia;
- ambiente;
- tabela;
- resumo;
- links.

Client Component:

- filtro;
- escala;
- tooltip;
- alternância de métrica;
- destaque.

## 17.3. SEO

Cada suite recebe URL própria:

```text
/benchmarks/equal
/benchmarks/arrays
/benchmarks/objects
```

Metadata inclui:

- operação;
- runtime;
- data;
- metodologia;
- commit quando útil.

---

# 18. Snippets sincronizados

## 18.1. Regra

Todo snippet público deve ser validado no CI.

## 18.2. Estrutura

```text
examples/
├── getting-started.ts
├── object-schema.ts
├── equal.ts
└── build-output.ts
```

O script de docs:

- lê regiões marcadas;
- gera conteúdo;
- executa typecheck;
- falha se imports ou assinaturas mudarem.

## 18.3. API reference

Gerar a partir de:

- exports;
- `.d.ts`;
- TSDoc;
- tipos;
- metadata do compilador.

Não duplicar manualmente a mesma assinatura em várias páginas.

---

# 19. SEO técnico com Next.js

## 19.1. Metadata API

Usar `metadata` para páginas estáticas e `generateMetadata` quando derivado de conteúdo.

```ts
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Specialized TypeScript Code Generation",
  description: "Descrição pública validada.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    title: "JIT",
    description: "Descrição pública validada.",
  },
};
```

## 19.2. Metadata base

Definir uma única vez no root layout:

```ts
metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL!);
```

Falhar no build de produção se a URL estiver ausente.

## 19.3. Sitemap

Criar `app/sitemap.ts`.

```ts
import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: "https://DOMINIO_REAL/",
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
  ];
}
```

Gerar entradas a partir de:

- docs;
- API;
- benchmark suites;
- blog;
- changelog.

Não usar `new Date()` em todas as páginas se a data real não mudou.

## 19.4. Robots

Criar `app/robots.ts`.

```ts
import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/playground/share/"],
    },
    sitemap: "https://DOMINIO_REAL/sitemap.xml",
  };
}
```

## 19.5. Open Graph

Usar:

- `opengraph-image.tsx`;
- `twitter-image.tsx`;
- `ImageResponse`;
- templates por seção;
- cache;
- fonte local quando suportada;
- mascote e código sem excesso de texto.

## 19.6. JSON-LD

Renderizar `<script type="application/ld+json">` em Server Component.

Tipos possíveis:

- `SoftwareSourceCode`;
- `SoftwareApplication`;
- `TechArticle`;
- `BreadcrumbList`;
- `BlogPosting`.

Sanitizar `<` no JSON serializado.

## 19.7. Canonical

- absoluta ou resolvida por `metadataBase`;
- uma URL por conteúdo;
- sem query de tracking;
- não canonicalizar docs distintas para a landing;
- canonical por idioma quando i18n existir.

## 19.8. Indexabilidade

Conteúdo relevante deve existir no HTML inicial:

- headings;
- corpo;
- code snippets;
- benchmark tables;
- links;
- FAQ;
- descrições;
- compatibilidade.

Não depender de Client Components para entregar conteúdo indexável.

---

# 20. SEO editorial

## 20.1. Páginas principais

- Introduction;
- Quick Start;
- Mental Model;
- Runtime JIT;
- OAT/build output;
- Code generation;
- Equal;
- Validation;
- Transform;
- Optimizer;
- Benchmark methodology;
- CSP and restricted runtimes;
- Bundler integration.

## 20.2. Intenções de busca

Conteúdo genuíno para:

- TypeScript code generation;
- generated validators;
- specialized deep equal;
- runtime schema compiler;
- ahead-of-time schema generation;
- JavaScript specialization;
- schema optimizer.

Não criar páginas finas por keyword.

## 20.3. Conteúdo para mecanismos de IA

Priorizar:

- respostas diretas;
- headings claros;
- definições;
- exemplos;
- fonte e autoria;
- versão;
- data de revisão;
- links para código;
- metodologia;
- limitações.

Não adicionar markup inventado de “AI SEO”.

---

# 21. Performance

## 21.1. Metas

| Métrica            |          Meta |
| ------------------ | ------------: |
| LCP mobile p75     |      `≤ 2.0s` |
| INP p75            |     `≤ 150ms` |
| CLS p75            |      `≤ 0.05` |
| TTFB cache hit     |     `≤ 500ms` |
| JS inicial landing | `≤ 90kB gzip` |
| JS inicial docs    | `≤ 55kB gzip` |
| CSS crítico        | `≤ 30kB gzip` |
| Hero visual        |     `≤ 180kB` |
| Sprite inicial     |      `≤ 40kB` |

O budget de JavaScript é ligeiramente maior que o plano Next.js, mas deve ser tratado como teto, não objetivo.

## 21.2. Bundle

- Server Components não devem importar libs client-only;
- analisar bundle;
- usar imports específicos;
- evitar barrel files client-side gigantes;
- usar `optimizePackageImports` somente quando suportado e medido;
- lazy-load playground e charts;
- não enviar benchmark raw data inteiro para a landing.

## 21.3. Prefetch

O Next.js pode fazer prefetch de links visíveis. Não criar centenas de links visíveis de uma vez na landing.

Em listas extensas:

- limitar prefetch;
- paginar ou agrupar;
- usar navegação da docs com cuidado.

## 21.4. Imagens

- `next/image`;
- `sizes` correto;
- `priority` somente para LCP;
- AVIF/WebP;
- blur placeholder quando útil;
- sprites sem smoothing;
- dimensões fixas.

## 21.5. Fonts

- `next/font`;
- subset;
- poucos pesos;
- pixel font não crítica;
- evitar fontes duplicadas pelo Fumadocs.

## 21.6. JavaScript

Não usar Client Component para:

- revelar texto;
- renderizar cards;
- montar footer;
- produzir layout;
- syntax highlight estático;
- tabela estática.

## 21.7. Main thread

- pointer tracking fora de React state;
- worker no playground;
- chart data agregado no servidor;
- parsing de MDX no build;
- animações apenas em transform/opacity;
- pausar quando `document.hidden`.

---

# 22. Caching

## 22.1. Conteúdo versionado

Docs e benchmarks no repositório podem ser gerados no build.

## 22.2. Conteúdo remoto

Quando houver fetch:

- cache explícito;
- revalidate coerente;
- tags quando necessário;
- não usar `no-store` por padrão;
- separar conteúdo público de dados personalizados.

## 22.3. Revalidation

ISR pode ser usado para:

- GitHub stars;
- npm downloads;
- releases;
- changelog remoto.

Esses dados nunca devem bloquear o hero.

## 22.4. Cache Components

Avaliar somente após dominar o modelo da versão atual. Não introduzir complexidade de PPR e cache em uma landing essencialmente estática sem necessidade.

---

# 23. Acessibilidade

## 23.1. Objetivo

WCAG 2.2 AA.

## 23.2. Requisitos

- landmarks;
- heading hierarchy;
- skip link;
- focus visible;
- teclado;
- contraste;
- touch targets;
- reduced motion;
- zoom 200%;
- code blocks acessíveis;
- tables para charts;
- dialogs com foco;
- drawer acessível;
- mascot toggle.

## 23.3. Mascote

Decorativo:

```tsx
<div aria-hidden="true" role="presentation" />
```

Status funcional:

```tsx
<div role="status" aria-live="polite">
  Compilation completed.
</div>
```

Não anunciar movimentos.

---

# 24. Analytics

## 24.1. Eventos

- install copied;
- code copied;
- docs search;
- generated code opened;
- playground loaded;
- compile run;
- benchmark methodology opened;
- GitHub outbound;
- mascot hidden;
- reduced motion selected.

## 24.2. Restrições

- não registrar código do playground;
- não registrar cursor;
- não usar session replay por padrão;
- não adicionar analytics bloqueante;
- carregar depois de consentimento quando aplicável;
- usar `next/script` com estratégia adequada.

---

# 25. Segurança

- CSP;
- sem secrets no cliente;
- sanitizar JSON-LD;
- sanitizar conteúdo remoto;
- evitar `dangerouslySetInnerHTML` fora de casos controlados;
- dependências atualizadas;
- headers de segurança no deploy;
- worker isolado;
- sem execução arbitrária no servidor;
- documentar impacto de `new Function` e CSP para runtime JIT;
- preferir OAT em ambientes restritos.

---

# 26. Testes

## 26.1. Unit

- state machine do mascote;
- metadata;
- canonical;
- benchmark transforms;
- serializers;
- safe areas;
- preferences.

## 26.2. E2E

- landing;
- docs navigation;
- search;
- copy;
- tabs;
- playground;
- benchmark filters;
- mobile menu;
- reduced motion;
- hide mascot.

## 26.3. Accessibility

Executar Axe em:

- landing;
- docs;
- benchmark;
- playground shell;
- mobile drawer;
- dialogs.

## 26.4. Performance

Lighthouse CI em:

- `/`;
- `/docs`;
- página longa de docs;
- `/benchmarks`;
- `/playground` shell.

## 26.5. Visual

Capturas:

- 360 × 800;
- 390 × 844;
- 768 × 1024;
- 1024 × 768;
- 1280 × 800;
- 1440 × 900;
- 1920 × 1080.

---

# 27. CI

Pipeline:

```text
install
→ biome
→ typecheck
→ validate snippets
→ unit tests
→ build
→ check links
→ Playwright
→ Axe
→ Lighthouse CI
→ artifact
```

Falhar quando:

- snippet não compila;
- metadata obrigatória está ausente;
- link interno quebra;
- página de conteúdo não gera;
- sitemap possui URL inválida;
- budget crítico é excedido;
- acessibilidade crítica falha.

---

# 28. Fases de implementação

## Fase 0 — descoberta

- nome do pacote;
- domínio;
- exports;
- operações;
- runtimes;
- JIT/OAT terminology;
- benchmarks;
- estabilidade;
- assets;
- conteúdo existente.

## Fase 1 — Next.js e Fumadocs

- projeto;
- App Router;
- Fumadocs;
- Tailwind;
- tokens;
- fonts;
- root layout;
- landing vazia;
- docs;
- metadata;
- sitemap;
- robots;
- CI.

## Fase 2 — conteúdo essencial

- hero;
- quick start;
- mental model;
- schema to code;
- runtime/OAT;
- operações;
- docs iniciais;
- methodology.

## Fase 3 — identidade

- logo variants;
- palette;
- pixel icons;
- terminal;
- static mascot;
- 404;
- code panels;
- docs theme.

## Fase 4 — motion

- hero animation;
- mascot loader;
- state machine;
- pointer behavior;
- section reactions;
- reduced motion;
- hidden mode.

## Fase 5 — benchmarks

- data generator;
- tables;
- charts;
- filters;
- suites;
- raw data;
- metadata.

## Fase 6 — playground

- worker;
- editor;
- compile;
- output;
- share;
- errors;
- security;
- lazy loading.

## Fase 7 — hardening

- accessibility;
- SEO audit;
- performance audit;
- browser matrix;
- mobile;
- redirects;
- field vitals;
- content review.

---

# 29. Acceptance criteria

## Arquitetura

- [ ] App Router.
- [ ] Server Components por padrão.
- [ ] Nenhum `"use client"` em layout raiz.
- [ ] Fumadocs integrado.
- [ ] Docs pré-renderizadas.
- [ ] Playground separado.
- [ ] Mascote progressivamente aprimorado.

## Conteúdo

- [ ] Nenhuma API inventada.
- [ ] Snippets compilam.
- [ ] Claims verificáveis.
- [ ] Runtime support explícito.
- [ ] JIT/OAT explicados.
- [ ] Benchmark methodology publicada.
- [ ] Limitações documentadas.

## SEO

- [ ] Metadata por página.
- [ ] Canonicals.
- [ ] Sitemap.
- [ ] Robots.
- [ ] Open Graph.
- [ ] JSON-LD.
- [ ] Internal links.
- [ ] HTML indexável.
- [ ] 404.
- [ ] Redirects.

## Performance

- [ ] LCP meta.
- [ ] INP meta.
- [ ] CLS meta.
- [ ] JS budget.
- [ ] Images budget.
- [ ] Fonts budget.
- [ ] No client root.
- [ ] Playground lazy.
- [ ] Chart lazy.
- [ ] Mascot lazy.

## Acessibilidade

- [ ] Teclado.
- [ ] Focus visible.
- [ ] Contrast AA.
- [ ] Reduced motion.
- [ ] Mascot toggle.
- [ ] Tables for charts.
- [ ] Axe sem violações críticas.

---

# 30. Lighthouse CI

Exemplo:

```json
{
  "ci": {
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.93 }],
        "categories:accessibility": ["error", { "minScore": 0.98 }],
        "categories:best-practices": ["error", { "minScore": 0.95 }],
        "categories:seo": ["error", { "minScore": 1 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2000 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05 }],
        "total-blocking-time": ["error", { "maxNumericValue": 180 }]
      }
    }
  }
}
```

Lighthouse lab não substitui Core Web Vitals de campo.

---

# 31. Decisões que o agente não pode tomar sozinho

Solicitar validação antes de:

- mudar nome público da biblioteca;
- publicar benchmark;
- definir compatibilidade;
- declarar estabilidade;
- escolher domínio;
- criar pricing;
- mudar terminologia JIT/OAT;
- remover feature documentada;
- introduzir serviço externo;
- enviar analytics;
- criar autenticação;
- armazenar código do playground.

---

# 32. Não fazer

- não usar Pages Router;
- não tornar tudo Client Component;
- não colocar providers globais sem necessidade;
- não hidratar a docs inteira;
- não usar Framer/Motion em todos os cards;
- não usar WebGL no hero por padrão;
- não usar canvas para conteúdo;
- não usar cursor customizado obrigatório;
- não usar scroll-jacking;
- não usar fonte pixel no corpo;
- não copiar o InVideo literalmente;
- não inventar API;
- não inventar benchmark;
- não bloquear conteúdo pela animação;
- não depender de JavaScript para SEO;
- não usar static export sem avaliar limitações;
- não carregar playground na landing;
- não adicionar CMS antes de existir necessidade editorial.

---

# 33. Prompt operacional atualizado

```text
Você está implementando o site oficial da biblioteca JIT.

Leia integralmente:
1. jit-design-system.md
2. jit-website-agent-implementation-guide.md
3. README, exports, tipos, testes e benchmarks do repositório.

Stack obrigatória:
- Next.js App Router
- React Server Components por padrão
- Fumadocs Core/UI/MDX
- Tailwind CSS 4 + CSS custom properties
- Motion apenas em Client Components interativos
- TypeScript strict
- Vitest, Playwright, Axe e Lighthouse CI

Regras:
- Não invente APIs, nomes de pacote, runtimes, versões, resultados ou claims.
- Toda amostra pública deve compilar no CI.
- Não use "use client" em layouts ou páginas inteiras.
- Landing, docs, API reference e benchmark tables devem existir no HTML inicial.
- O mascote deve possuir fallback estático, ser carregado progressivamente,
  respeitar reduced motion e nunca cobrir controles.
- Playground, charts e demos pesadas devem ser carregados sob demanda.
- Use Metadata API, sitemap.ts, robots.ts, Open Graph e JSON-LD.
- Preserve os budgets de Core Web Vitals e JavaScript.
- Benchmarks precisam de metodologia e dados reproduzíveis.
- Finalize conteúdo, semântica, responsividade e acessibilidade antes do motion.
- Trabalhe em fases pequenas, execute testes e apresente métricas por fase.
```

---

# 34. Referências oficiais

## Next.js

- App Router: https://nextjs.org/docs/app
- Server and Client Components: https://nextjs.org/docs/app/getting-started/server-and-client-components
- Public/static pages: https://nextjs.org/docs/app/guides/public-static-pages
- Static exports: https://nextjs.org/docs/app/guides/static-exports
- Images: https://nextjs.org/docs/app/getting-started/images
- Fonts: https://nextjs.org/docs/app/getting-started/fonts
- Metadata and OG: https://nextjs.org/docs/app/getting-started/metadata-and-og-images
- generateMetadata: https://nextjs.org/docs/app/api-reference/functions/generate-metadata
- Sitemap: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
- Robots: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots
- JSON-LD: https://nextjs.org/docs/app/guides/json-ld
- Production checklist: https://nextjs.org/docs/app/guides/production-checklist
- Package bundling: https://nextjs.org/docs/app/guides/package-bundling

## Fumadocs

- Documentation: https://www.fumadocs.dev/docs
- Next.js installation: https://www.fumadocs.dev/docs/manual-installation/next
- Fumadocs MDX: https://www.fumadocs.dev/docs/mdx/next
- UI: https://www.fumadocs.dev/docs/ui
- Search: https://www.fumadocs.dev/docs/search
- Static build: https://www.fumadocs.dev/docs/deploying/static

## Outros

- Motion: https://motion.dev/
- Google Search Essentials: https://developers.google.com/search/docs/essentials
- SEO Starter Guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Helpful Content: https://developers.google.com/search/docs/fundamentals/creating-helpful-content
- Core Web Vitals: https://web.dev/articles/vitals

---

# 35. Resultado esperado

O site final deve:

- usar Next.js sem enviar React desnecessário ao cliente;
- oferecer documentação rápida e pesquisável;
- centralizar o código gerado na narrativa;
- explicar JIT e OAT com precisão;
- possuir identidade 16-bit memorável;
- usar o fantasminha como guia, não como distração;
- manter conteúdo totalmente indexável;
- apresentar benchmarks reproduzíveis;
- funcionar muito bem em mobile;
- atingir excelentes Core Web Vitals;
- ser simples para a equipe evoluir dentro de uma stack familiar.
