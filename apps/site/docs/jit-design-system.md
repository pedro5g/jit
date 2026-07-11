
# JIT — Design System completo

Este documento contém duas partes:

1. o sistema visual específico da JIT, incluindo a identidade 16-bit e o mascote;
2. a auditoria-base do InVideo usada como referência editorial.

---


# JIT Website Design System

> **Produto:** JIT — biblioteca TypeScript de especialização, geração de código e compilação de operações de alto desempenho.  
> **Base visual:** sistema editorial escuro inspirado na landing do InVideo, reinterpretado para uma identidade técnica, 16-bit e orientada a performance.  
> **Ativo principal analisado:** `jit.logo.png` — composição pixel art com mascote fantasma, terminal `.JIT`, fundo azul-preto e iluminação marfim/dourada.  
> **Escopo:** landing page, documentação, blog técnico, benchmarks, playground, páginas de API e materiais Open Graph.

---

## 0. Direção estratégica

A JIT não deve parecer:

- mais uma landing genérica de biblioteca JavaScript;
- um site inteiro com estética de videogame retrô;
- uma cópia visual do InVideo;
- uma documentação decorada com pixel art sem relação funcional;
- uma interface que sacrifica legibilidade para parecer “16-bit”.

A proposta correta é uma combinação de três camadas:

1. **Estrutura editorial premium:** grandes áreas de respiro, títulos fortes, superfícies escuras, demos reais do produto e narrativa por seções.
2. **Identidade 16-bit:** mascote, ícones, divisores, cursores, partículas, microestados, ilustrações e detalhes de terminal.
3. **Engenharia de performance:** HTML estático, JavaScript progressivo, animações isoladas, assets pequenos e documentação totalmente indexável.

A experiência deve comunicar visualmente o mesmo princípio da biblioteca:

> **trabalho complexo durante a compilação; execução simples, direta e rápida para o usuário.**

---

# 1. Conceito criativo

## 1.1. Tema central

**“A pequena entidade que transforma schemas em código especializado.”**

O fantasminha representa o compilador/agente interno da JIT. Ele não é apenas uma mascote decorativa. Sua função narrativa é:

- entrar em um schema;
- observar uma operação;
- analisar estruturas;
- compilar;
- gerar código;
- eliminar branches;
- acelerar loops;
- comparar resultados;
- celebrar ganhos de performance;
- orientar o usuário pela documentação.

## 1.2. Metáforas visuais

| Conceito técnico | Metáfora visual |
|---|---|
| Schema | blueprint, mapa ou cartucho |
| Normalização | peças sendo alinhadas em uma grade |
| IR | blocos intermediários conectados |
| Compiler pass | fantasminha atravessando uma sequência de portais |
| Codegen | terminal imprimindo código |
| JIT runtime | faísca curta antes da execução |
| OAT/AOT | cartucho já compilado e pronto para uso |
| Optimizer | remoção de blocos e atalhos |
| Hoisting | item sendo elevado para fora de um loop |
| Loop unrolling | pista dividida em vários segmentos |
| Cache | baú ou memória de terminal |
| Benchmark | corrida controlada entre implementações |
| Zero runtime overhead | caminho reto sem obstáculos |

## 1.3. Personalidade

A marca deve ser:

- técnica;
- confiante;
- rápida;
- curiosa;
- amigável;
- ligeiramente divertida;
- precisa;
- não infantil.

O fantasminha pode ser simpático, mas o conteúdo e a interface devem continuar transmitindo credibilidade de engenharia.

---

# 2. Princípios de experiência

## 2.1. “Show the generated code”

Toda feature relevante deve ser explicada por uma demonstração concreta:

- schema de entrada;
- transformação;
- código especializado gerado;
- resultado;
- impacto de performance.

Evitar cards que apenas dizem “fast”, “type-safe” ou “powerful”.

## 2.2. Progressive delight

A página precisa funcionar completamente sem as animações avançadas. A ordem de prioridade é:

1. conteúdo;
2. semântica;
3. legibilidade;
4. navegação;
5. performance;
6. motion;
7. efeitos decorativos.

## 2.3. Pixel art como acento

A camada 16-bit deve ocupar aproximadamente:

- **10–20%** da superfície visual da documentação;
- **20–35%** da landing;
- até **45%** do hero, quando integrada à demonstração do produto.

Parágrafos, tabelas e blocos de código não devem usar fonte pixelada.

## 2.4. Sem cursor customizado obrigatório

O site não deve substituir o cursor nativo. O fantasminha reage ao cursor, mas o usuário preserva:

- precisão;
- previsibilidade;
- estados nativos;
- acessibilidade;
- comportamento normal do navegador.

## 2.5. Motion subordinado à leitura

Nenhuma animação deve:

- bloquear scroll;
- deslocar o conteúdo que está sendo lido;
- perseguir o cursor agressivamente;
- cobrir código;
- reaparecer em excesso;
- causar layout shift;
- permanecer ativa fora da viewport;
- ignorar `prefers-reduced-motion`.

---

# 3. Identidade extraída do logo

## 3.1. Características do ativo

O logo enviado apresenta:

- resolução de `1536 × 1024`;
- fundo azul-preto;
- mascote em marfim;
- terminal em grafite;
- texto `.JIT` em dourado;
- bordas pixeladas;
- glow suave;
- partículas horizontais que sugerem velocidade;
- contraste entre personagem orgânico e terminal geométrico.

## 3.2. Paleta extraída e normalizada

As cores dominantes observadas no ativo foram normalizadas nos seguintes tokens.

### Fundo

| Token | Hex | Uso |
|---|---|---|
| `jit-night-1000` | `#0D1018` | preto azulado mais profundo |
| `jit-night-950` | `#121520` | background elevado profundo |
| `jit-night-900` | `#151822` | fundo principal derivado do logo |
| `jit-night-850` | `#171B25` | variação de seção |
| `jit-night-800` | `#1D222B` | cards e painéis |

### Terminal e superfícies

| Token | Hex | Uso |
|---|---|---|
| `terminal-900` | `#23292F` | painel interno |
| `terminal-800` | `#2F373C` | terminal e superfícies elevadas |
| `terminal-700` | `#31393D` | borda e hover |
| `terminal-600` | `#454D50` | elementos secundários |
| `terminal-500` | `#595C54` | detalhes e estados desabilitados |

### Fantasma e luz

| Token | Hex | Uso |
|---|---|---|
| `ghost-100` | `#F3EFD1` | highlight máximo |
| `ghost-200` | `#E9E4C3` | luz principal |
| `ghost-300` | `#DDD9B5` | corpo do mascote |
| `ghost-400` | `#D1CAA4` | sombra suave |
| `ghost-500` | `#BEAE82` | contorno/sombra quente |

### Dourados

| Token | Hex | Uso |
|---|---|---|
| `jit-gold-100` | `#FFE7A5` | brilho |
| `jit-gold-200` | `#F7D27E` | destaque principal |
| `jit-gold-300` | `#E8BB5E` | ação/seleção |
| `jit-gold-400` | `#C9953D` | estado pressionado |
| `jit-gold-glow` | `rgba(247, 210, 126, .24)` | halo |

## 3.3. Paleta semântica do site

```css
:root {
  --jit-bg: #151822;
  --jit-bg-deep: #0d1018;
  --jit-bg-raised: #1d222b;

  --jit-surface: #23292f;
  --jit-surface-raised: #2f373c;
  --jit-surface-hover: #31393d;

  --jit-text: #f3efd1;
  --jit-text-strong: #ffffff;
  --jit-text-muted: #aeb2b3;
  --jit-text-subtle: #777f82;

  --jit-ghost: #ddd9b5;
  --jit-ghost-highlight: #f3efd1;
  --jit-ghost-shadow: #beae82;

  --jit-gold: #f7d27e;
  --jit-gold-strong: #e8bb5e;
  --jit-gold-muted: #c9953d;

  --jit-success: #79d69b;
  --jit-info: #7db7ff;
  --jit-warning: #f7d27e;
  --jit-danger: #ef7181;

  --jit-border: rgba(221, 217, 181, .10);
  --jit-border-strong: rgba(247, 210, 126, .26);
}
```

## 3.4. Cores de syntax highlighting

| Token | Hex | Uso |
|---|---|---|
| Keyword | `#C69CFF` | `const`, `type`, `return` |
| Type | `#7DB7FF` | tipos e interfaces |
| Function | `#F7D27E` | chamadas e nomes compilados |
| String | `#9DDBA8` | strings |
| Number | `#FFB86B` | números |
| Comment | `#6F777B` | comentários |
| Operator | `#E8E2C5` | operadores |
| Error | `#EF7181` | diagnósticos |
| Generated | `#79D69B` | código produzido pela JIT |

---

# 4. Tipografia da JIT

## 4.1. Família principal

**Inter Variable**

Uso:

- corpo;
- títulos editoriais;
- navegação;
- documentação;
- botões;
- tabelas;
- componentes.

```css
font-family:
  Inter,
  ui-sans-serif,
  system-ui,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

## 4.2. Família monoespaçada

**JetBrains Mono**

Uso:

- código;
- métricas;
- números de benchmark;
- tags técnicas;
- assinaturas;
- CLI;
- labels do terminal.

```css
font-family:
  "JetBrains Mono",
  "SFMono-Regular",
  Consolas,
  "Liberation Mono",
  monospace;
```

## 4.3. Família pixel

Recomendação principal:

- **Pixelify Sans** para headings curtos e peças de campanha;
- **Silkscreen** para badges compactos;
- ou uma fonte pixel proprietária derivada visualmente do logo.

Uso máximo:

- eyebrow;
- labels;
- badges;
- palavra `.JIT`;
- números grandes;
- estados do mascote;
- títulos de até 4–6 palavras.

Nunca usar em:

- corpo;
- documentação longa;
- tabelas;
- mensagens de erro extensas;
- links de navegação principais;
- código.

## 4.4. Escala híbrida

| Token | Fonte | Tamanho | Uso |
|---|---|---:|---|
| `display-hero` | Inter | `64–88px` | headline do hero |
| `display-pixel` | Pixel | `36–56px` | destaque 16-bit curto |
| `heading-section` | Inter | `44–56px` | seções |
| `heading-card` | Inter | `22–28px` | cards |
| `body-lead` | Inter | `18–20px` | intro |
| `body` | Inter | `16px` | texto |
| `code-lg` | JetBrains Mono | `16px` | demos |
| `code` | JetBrains Mono | `14px` | docs |
| `metric-xl` | JetBrains Mono | `40–64px` | benchmark |
| `pixel-label` | Pixel | `11–14px` | badge |

## 4.5. Regra de contraste tipográfico

Em um mesmo bloco:

- no máximo duas famílias;
- fonte pixel apenas como detalhe;
- código sempre monoespaçado;
- headings longos sempre em Inter.

---

# 5. Geometria híbrida

A identidade combina cantos editoriais suaves com componentes pixelados.

## 5.1. Superfícies editoriais

- raio `16–24px`;
- bordas de 1px;
- shadows profundas;
- grandes áreas de respiro.

## 5.2. Elementos 16-bit

- raio `0–4px`;
- bordas de `2px`;
- degraus de `4px` ou `8px`;
- sombras duras;
- movimentos em frames.

## 5.3. Regra de composição

Um card grande pode ter:

- moldura externa arredondada;
- painel interno com cantos retos;
- badge pixel;
- mascote sprite;
- terminal monoespaçado.

Isso evita que a página inteira pareça uma interface antiga.

## 5.4. Stepped corners

```css
.pixel-panel {
  clip-path: polygon(
    8px 0,
    calc(100% - 8px) 0,
    calc(100% - 8px) 4px,
    calc(100% - 4px) 4px,
    calc(100% - 4px) 8px,
    100% 8px,
    100% calc(100% - 8px),
    calc(100% - 4px) calc(100% - 8px),
    calc(100% - 4px) calc(100% - 4px),
    calc(100% - 8px) calc(100% - 4px),
    calc(100% - 8px) 100%,
    8px 100%,
    8px calc(100% - 4px),
    4px calc(100% - 4px),
    4px calc(100% - 8px),
    0 calc(100% - 8px),
    0 8px,
    4px 8px,
    4px 4px,
    8px 4px
  );
}
```

---

# 6. Pixel grid

## 6.1. Unidade base

A arte 16-bit usa uma unidade lógica de **4px**.

| Token | Valor |
|---|---:|
| `pixel-1` | `4px` |
| `pixel-2` | `8px` |
| `pixel-3` | `12px` |
| `pixel-4` | `16px` |
| `pixel-6` | `24px` |
| `pixel-8` | `32px` |

## 6.2. Escala dos sprites

Todos os sprites devem ser produzidos em dimensões lógicas pequenas e ampliados por múltiplos inteiros:

- `2x`;
- `3x`;
- `4x`;
- `6x`;
- `8x`.

Evitar escalas fracionárias como `1.5x` ou `2.75x`.

## 6.3. Renderização

```css
.pixel-art {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
```

## 6.4. Tamanhos recomendados do mascote

| Contexto | Tamanho visual |
|---|---:|
| Favicon | `16–32px` |
| Badge | `24–32px` |
| Navegação | `32–40px` |
| Docs flutuante | `40–56px` |
| Card | `64–96px` |
| Seção | `96–144px` |
| Hero | `160–240px` |

---

# 7. O fantasminha como sistema de produto

## 7.1. Nome interno

Até a definição pública do nome, o componente deve ser chamado no código de:

```ts
JitGhost
```

Não espalhar um nome temporário pelo conteúdo editorial.

## 7.2. Funções

O mascote pode:

- observar;
- seguir com atraso;
- apontar;
- ler;
- digitar;
- atravessar cards;
- carregar um schema;
- empurrar blocos;
- remover branches;
- iniciar um benchmark;
- reagir à cópia de código;
- comemorar uma compilação;
- indicar erro;
- dormir quando inativo.

## 7.3. Estados

```ts
type JitGhostState =
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

## 7.4. Eventos semânticos

```ts
type JitGhostEvent =
  | { type: "SECTION_ENTER"; section: string }
  | { type: "SECTION_LEAVE"; section: string }
  | { type: "CURSOR_NEAR"; x: number; y: number }
  | { type: "CURSOR_FAR" }
  | { type: "CODE_COPY" }
  | { type: "COMPILE_START" }
  | { type: "COMPILE_SUCCESS" }
  | { type: "COMPILE_ERROR" }
  | { type: "BENCHMARK_START" }
  | { type: "BENCHMARK_FINISH" }
  | { type: "USER_IDLE" }
  | { type: "REDUCED_MOTION" };
```

## 7.5. Prioridade de estados

```text
error
  > warning
  > compiling
  > optimizing
  > success
  > pointing
  > following
  > observing
  > idle
  > sleeping
```

Eventos decorativos nunca devem interromper:

- leitura;
- foco;
- seleção de texto;
- interação com código;
- navegação por teclado.

## 7.6. Regra de frequência

- máximo de uma ação principal por seção;
- máximo de uma celebração por sessão para o mesmo evento;
- não executar entrada dramática em toda navegação;
- após 30–45 segundos de inatividade, entrar em estado tranquilo;
- após interação de teclado, não perseguir foco visualmente.

---

# 8. Interação com o cursor

## 8.1. Comportamento correto

O mascote não deve se posicionar diretamente sob o ponteiro. Ele deve:

- observar o cursor com os olhos;
- inclinar o corpo alguns pixels;
- mover-se apenas dentro de uma área segura;
- seguir com mola e atraso;
- parar antes de cobrir elementos interativos.

## 8.2. Distâncias

| Estado | Distância |
|---|---:|
| Olhar acompanha cursor | viewport inteiro |
| Inclinação | cursor em até `240px` |
| Aproximação | cursor em até `160px` |
| Recuo | cursor em até `56px` |
| Área segura de elemento | `24–40px` |

## 8.3. Movimento máximo

- deslocamento dos olhos: `2–4px`;
- deslocamento do corpo: `8–20px`;
- rotação: até `4deg`;
- escala hover: até `1.03`;
- atraso visual: `60–140ms`.

## 8.4. Ponteiros coarse

Em dispositivos touch:

- desativar follow pointer;
- usar tap para pequenas reações;
- manter o mascote em posição fixa ou inline;
- nunca depender de hover.

```css
@media (pointer: coarse) {
  .jit-ghost[data-mode="cursor"] {
    display: none;
  }
}
```

---

# 9. Animação por sprites

## 9.1. Quando usar sprite sheet

Usar sprite para:

- idle;
- floating;
- blink;
- typing;
- success;
- sleep;
- warning;
- run.

## 9.2. Quando usar DOM/SVG

Usar DOM ou SVG para:

- olhos acompanhando o cursor;
- labels;
- partículas;
- linhas;
- terminal;
- transformações suaves;
- conexão com elementos.

## 9.3. Estrutura de um sprite

Exemplo:

- frame lógico: `32 × 32px`;
- 8 frames;
- sprite horizontal: `256 × 32px`;
- escala visual: `4x`;
- duração: `800–1200ms`.

```css
@keyframes ghost-idle {
  from { background-position: 0 0; }
  to { background-position: -256px 0; }
}

.ghost-idle {
  width: 32px;
  height: 32px;
  background-image: url("/sprites/ghost-idle.webp");
  background-size: 256px 32px;
  animation: ghost-idle 1s steps(8) infinite;
  transform: scale(4);
  transform-origin: top left;
}
```

## 9.4. FPS visual

| Animação | FPS recomendado |
|---|---:|
| Idle pixel | `6–8fps` |
| Floating | `8–12fps` |
| Run | `12–16fps` |
| Blink | `4–6fps` |
| Efeito suave DOM | `60–120fps`, conforme tela |

A baixa taxa de frames da arte deve ser intencional; o movimento do container pode continuar suave.

---

# 10. Arquitetura de motion

## 10.1. Camadas

### Camada A — CSS

Usar para:

- hover;
- focus;
- opacity;
- transforms simples;
- loops de sprite;
- glow;
- marquee;
- pequenos indicadores.

### Camada B — Web Animations/Motion mini

Usar para:

- entrada;
- scroll progress;
- cursor spring;
- stagger;
- transições entre estados;
- sequências curtas.

### Camada C — componente interativo

Usar apenas para:

- estado global do mascote;
- playground;
- benchmark interativo;
- diagramas;
- demos compiláveis.

## 10.2. Propriedades prioritárias

Animar preferencialmente:

- `transform`;
- `opacity`;
- `clip-path` em áreas pequenas;
- CSS variables numéricas;
- `filter` apenas em elementos pequenos.

Evitar:

- `top`;
- `left`;
- `width`;
- `height`;
- sombras animadas gigantes;
- blur sobre tela inteira;
- leituras e escritas de layout intercaladas.

## 10.3. Curvas

```css
:root {
  --jit-ease-out: cubic-bezier(.16, 1, .3, 1);
  --jit-ease-snap: cubic-bezier(.22, 1.5, .36, 1);
  --jit-ease-linear: linear;
}
```

## 10.4. Spring do mascote

Configuração inicial recomendada:

```ts
const ghostSpring = {
  stiffness: 240,
  damping: 24,
  mass: 0.72,
};
```

Ajustar visualmente e medir INP.

---

# 11. Acessibilidade do mascote

## 11.1. Decorativo

Quando não comunica informação:

```html
<div aria-hidden="true" role="presentation"></div>
```

## 11.2. Informativo

Quando indica compilação:

```html
<div role="status" aria-live="polite">
  Compilação concluída.
</div>
```

O texto acessível não precisa descrever cada movimento do personagem.

## 11.3. Controle do usuário

A documentação deve oferecer no menu de aparência:

- animações completas;
- animações reduzidas;
- mascote oculto.

A escolha pode ser salva em `localStorage`.

## 11.4. Reduced motion

Com `prefers-reduced-motion: reduce`:

- remover follow pointer;
- remover parallax;
- usar uma pose estática;
- manter apenas fades curtos;
- não executar loops decorativos;
- preservar feedback de sucesso e erro sem deslocamento.

---

# 12. Landing page da JIT

## 12.1. Arquitetura

```text
Header
Hero
Proof strip
Why specialization
From schema to generated code
Runtime JIT vs OAT
Operators and features
Optimizer pipeline
Benchmarks
Developer experience
Framework/runtime compatibility
Playground CTA
Documentation CTA
Open source/community
Footer
```

## 12.2. Hero

### Objetivo

Explicar em menos de 8 segundos:

- o que é JIT;
- para quem serve;
- qual problema resolve;
- por que é diferente;
- como começar.

### Composição

Lado esquerdo:

- eyebrow pixel;
- headline;
- descrição;
- CTA primário;
- CTA secundário;
- badges TypeScript/Node/browser.

Lado direito:

- terminal;
- schema;
- código gerado;
- mascote;
- partículas;
- indicador de tempo de compilação.

### Headline sugerida

```text
Compile intent.
Run specialized code.
```

Alternativa:

```text
Schemas in.
Straight-line code out.
```

Subheadline:

```text
A TypeScript code-generation toolkit for building specialized validators,
comparators, transforms and data operations—at runtime or ahead of time.
```

Usar texto final de acordo com a API pública já consolidada.

## 12.3. Animação do hero

Sequência:

1. logo/terminal aparece;
2. mascote flutua para dentro;
3. schema é inserido;
4. o terminal mostra “compiling”;
5. branches são removidos;
6. surge código especializado;
7. tempo reduz;
8. CTA fica disponível.

Duração total da primeira execução: `2.8–4.2s`.

A animação não pode atrasar a exibição do conteúdo nem o CTA.

---

# 13. Seção “Why specialization”

## 13.1. Narrativa

Mostrar a diferença entre:

- função genérica;
- interpretação repetida;
- função especializada;
- caminho direto.

## 13.2. Visual

Duas pistas:

### Generic path

- muitos nós;
- branches;
- verificações;
- dispatch;
- loops genéricos.

### JIT path

- linha reta;
- checks inline;
- propriedades conhecidas;
- loop especializado;
- early return.

O mascote remove blocos do caminho genérico e abre o caminho especializado.

## 13.3. Acessibilidade

O diagrama precisa ter uma explicação textual equivalente logo abaixo ou em `<figcaption>`.

---

# 14. Seção “Schema to code”

## 14.1. Estrutura

Três estágios:

```text
Schema → Normalized IR → Generated function
```

## 14.2. Interação

O usuário pode selecionar:

- equal;
- validate;
- parse;
- transform;
- encode;
- decode;
- index;
- sort/order.

Somente operadores reais da biblioteca devem entrar na versão pública.

## 14.3. Code diff

Mostrar:

- código de entrada;
- generated output;
- linhas otimizadas;
- branches removidos;
- constantes hoisted.

Botão:

```text
View generated code
```

---

# 15. JIT vs OAT

## 15.1. Duas rotas

### JIT runtime

- compila uma vez em runtime;
- reutiliza a função;
- ótimo para schemas dinâmicos;
- requer ambiente compatível com a estratégia de compilação.

### OAT/AOT build output

- gera arquivos durante o build;
- importa código pronto;
- evita custo de compilação no runtime;
- favorece ambientes restritos;
- melhora previsibilidade de deploy.

A terminologia final precisa seguir os nomes oficiais da biblioteca.

## 15.2. Visual

Dois cartuchos:

- **Runtime cartridge**;
- **Build cartridge**.

O fantasminha constrói o cartucho OAT e o encaixa no terminal.

---

# 16. Optimizer pipeline

## 16.1. Etapas visuais

- normalize;
- infer;
- analyze;
- inline;
- hoist;
- specialize;
- emit;
- verify.

## 16.2. Cards técnicos

Cada pass deve conter:

- nome;
- problema resolvido;
- exemplo before/after;
- impacto;
- limitações;
- link para docs.

## 16.3. Animação

O mascote atravessa as etapas apenas quando a seção entra na viewport pela primeira vez.

Não criar uma timeline infinita de animação.

---

# 17. Benchmarks

## 17.1. Princípios

Benchmarks devem mostrar:

- ambiente;
- runtime;
- versão;
- dataset;
- warmup;
- número de execuções;
- distribuição;
- fonte do benchmark;
- comando para reproduzir;
- margem de variação;
- comparação justa.

## 17.2. Visual

Preferir:

- barras horizontais;
- escala logarítmica quando necessária;
- toggle de unidade;
- tabela acessível;
- raw data para download;
- indicação “lower is better” ou “higher is better”.

## 17.3. Mascote

- inicia a corrida;
- aguarda;
- mostra a bandeira;
- não atravessa o gráfico;
- não altera a percepção dos valores.

## 17.4. Métricas

Números usam JetBrains Mono e alinhamento tabular:

```css
.benchmark-value {
  font-variant-numeric: tabular-nums;
}
```

---

# 18. Documentação 16-bit

## 18.1. Estrutura

A docs deve continuar sendo uma documentação profissional:

- sidebar clara;
- search;
- breadcrumbs;
- índice da página;
- conteúdo central;
- code blocks;
- callouts;
- version selector;
- edit on GitHub;
- navegação anterior/próxima.

## 18.2. Camada visual

Adicionar 16-bit em:

- separadores;
- bullets especiais;
- badges;
- ícones;
- callouts;
- status do playground;
- mascote flutuante;
- cabeçalhos de código;
- páginas 404;
- progresso de leitura.

## 18.3. Mascote na documentação

Modo padrão:

- posicionado no canto inferior direito;
- `40–56px`;
- baixa frequência de animação;
- observa code blocks;
- reage ao botão “copy”;
- aponta para links “next” após leitura longa;
- pode ser minimizado;
- nunca cobre conteúdo.

## 18.4. Reação a code copy

Sequência máxima de `600ms`:

1. usuário copia;
2. mascote levanta;
3. pequena faísca;
4. tooltip “copied”;
5. volta ao idle.

## 18.5. Callouts

| Tipo | Cor | Ícone do mascote |
|---|---|---|
| Note | azul | observando |
| Tip | verde | apontando |
| Performance | dourado | turbo |
| Warning | amarelo | alerta |
| Danger | vermelho | preocupado |
| Generated | marfim | digitando |

---

# 19. Navegação da documentação

## 19.1. Taxonomia inicial

```text
Getting Started
├── Introduction
├── Installation
├── Quick Start
├── Mental Model
└── Runtime Support

Core Concepts
├── Schemas
├── Compilation
├── Normalization
├── Generated Code
├── Caching
└── Errors

Schemas
├── Primitives
├── Object
├── Array
├── Tuple
├── Record
├── Map
├── Set
├── Union
├── Literal
├── Enum
└── Modifiers

Operations
├── Equal
├── Validate
├── Parse
├── Transform
├── Order
└── DTO Utilities

Compilation Modes
├── Runtime JIT
├── Build-time/OAT
├── Generated Package
└── CSP and Restricted Runtimes

Compiler
├── IR
├── Passes
├── Hints
├── Loop Optimizer
├── Hoisting
└── Code Emission

Guides
├── Node.js
├── Browser
├── Bundlers
├── Frameworks
├── Monorepos
└── Migration

Benchmarks
├── Methodology
├── Equal
├── Arrays
├── Objects
└── Reproducing Results

API Reference
Changelog
Contributing
```

A árvore final deve ser gerada a partir da API real e do estado atual do repositório.

---

# 20. Componentes específicos

## 20.1. `JitGhost`

Responsabilidades:

- renderizar sprite;
- reagir a eventos;
- respeitar preferências;
- evitar áreas proibidas;
- não possuir regras de negócio da página.

## 20.2. `CompilerDemo`

- tabs de operação;
- schema;
- código gerado;
- estado;
- copy;
- reset;
- permalink opcional.

## 20.3. `OptimizationPipeline`

- lista de passes;
- estado ativo;
- before/after;
- fallback estático.

## 20.4. `BenchmarkChart`

- SVG semântico;
- tabela fallback;
- filtros;
- responsividade;
- raw data.

## 20.5. `PixelBadge`

Variantes:

- neutral;
- gold;
- success;
- warning;
- danger;
- info.

## 20.6. `TerminalFrame`

- toolbar;
- título;
- status;
- code;
- footer;
- stepped corners internos.

## 20.7. `GeneratedCode`

- syntax highlighting;
- linhas destacadas;
- copy;
- expand;
- download;
- informação da operação.

---

# 21. Iconografia 16-bit

## 21.1. Grade

- grid lógico de `16 × 16`;
- versão `24 × 24`;
- traços alinhados a pixels inteiros;
- paleta máxima de 3–5 cores por ícone.

## 21.2. Ícones iniciais

- compile;
- schema;
- object;
- array;
- tuple;
- union;
- map;
- set;
- compare;
- validate;
- transform;
- optimize;
- cache;
- benchmark;
- terminal;
- package;
- runtime;
- build.

## 21.3. Regra

Ícones pixelados são usados em títulos e callouts. Controles pequenos podem usar ícones vetoriais convencionais para preservar clareza.

---

# 22. Backgrounds e atmosfera

## 22.1. Fundo principal

```css
.jit-background {
  background:
    radial-gradient(
      70% 50% at 50% 0%,
      rgba(247, 210, 126, .05),
      transparent 70%
    ),
    #151822;
}
```

## 22.2. Grid técnico

```css
.jit-grid {
  background-image:
    linear-gradient(rgba(221, 217, 181, .025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(221, 217, 181, .025) 1px, transparent 1px);
  background-size: 32px 32px;
}
```

## 22.3. Ruído

Ruído deve ser:

- extremamente sutil;
- estático;
- pequeno;
- otimizado;
- desativável;
- sem canvas contínuo.

## 22.4. Scanlines

Evitar scanlines em toda a página. Usar apenas dentro do terminal, com opacidade inferior a `0.025`.

---

# 23. Botões JIT

## 23.1. Primary

```css
.button-primary {
  color: #151822;
  background: #f7d27e;
  border: 1px solid #ffe7a5;
  box-shadow:
    0 8px 30px rgba(247, 210, 126, .12),
    inset 0 1px rgba(255, 255, 255, .35);
}
```

## 23.2. Secondary

- fundo terminal;
- texto ghost;
- borda marfim baixa;
- hover dourado discreto.

## 23.3. Pixel action

Para controles pequenos:

- altura múltipla de 4;
- cantos stepped;
- shadow dura de `4px`;
- pressão reduz shadow para `0–2px`.

## 23.4. Texto

- CTA principal em Inter semibold;
- badge interno opcional em Pixelify/Silkscreen;
- ícone em grid 16-bit.

---

# 24. Cards

## 24.1. Feature card

| Propriedade | Valor |
|---|---:|
| Fundo | `#1D222B` |
| Borda | `rgba(221,217,181,.10)` |
| Raio | `20–24px` |
| Padding | `24–32px` |
| Título | `22–26px` |
| Corpo | `15–17px` |
| Demo | mínimo `220px` |

## 24.2. Compiler card

- terminal interno;
- barra de status;
- código;
- mascot slot;
- status chips;
- overlay de glow localizado.

## 24.3. Hover

Hover apenas em cards clicáveis:

- `translateY(-2px)`;
- border dourada;
- shadow maior;
- duração `180–240ms`.

---

# 25. SEO visual e conteúdo

A estética 16-bit não pode transformar conteúdo importante em imagens.

Sempre renderizar como HTML:

- headlines;
- descrição;
- snippets de código;
- métricas;
- nomes de operações;
- links;
- FAQs;
- tabelas;
- documentação.

Usar pixel art como suporte, nunca como única fonte de informação.

---

# 26. Performance budgets do design system

## 26.1. Metas internas

Mais estritas que os limites gerais de “bom”:

| Métrica | Meta JIT |
|---|---:|
| LCP mobile p75 | `≤ 2.0s` |
| INP p75 | `≤ 150ms` |
| CLS p75 | `≤ 0.05` |
| TTFB estático | `≤ 500ms` |
| JS inicial da landing | `≤ 80kB gzip` |
| JS inicial da docs | `≤ 45kB gzip` |
| CSS crítico | `≤ 25kB gzip` |
| Hero image/sprite inicial | `≤ 180kB` |
| Fontes acima da dobra | `≤ 120kB total` |

Os limites externos de Core Web Vitals considerados “bons” são LCP de até 2,5s, INP de até 200ms e CLS de até 0,1. As metas internas acima deixam margem operacional.

## 26.2. Regras de assets

- preload apenas do asset LCP real;
- sprites em WebP lossless ou PNG indexado, conforme menor resultado;
- dimensões explícitas;
- fonts WOFF2 subset;
- lazy-load abaixo da dobra;
- não carregar playground no primeiro paint;
- não carregar charts interativos antes da viewport;
- pausar animações fora da viewport.

---

# 27. Design tokens completos da JIT

```css
@layer reset, tokens, base, components, utilities;

@layer tokens {
  :root {
    color-scheme: dark;

    --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
    --font-mono: "JetBrains Mono", ui-monospace, monospace;
    --font-pixel: "Pixelify Sans", monospace;

    --bg-1000: #0d1018;
    --bg-950: #121520;
    --bg-900: #151822;
    --bg-850: #171b25;
    --bg-800: #1d222b;

    --surface-900: #23292f;
    --surface-800: #2f373c;
    --surface-700: #31393d;
    --surface-600: #454d50;

    --ghost-100: #f3efd1;
    --ghost-200: #e9e4c3;
    --ghost-300: #ddd9b5;
    --ghost-400: #d1caa4;
    --ghost-500: #beae82;

    --gold-100: #ffe7a5;
    --gold-200: #f7d27e;
    --gold-300: #e8bb5e;
    --gold-400: #c9953d;

    --success: #79d69b;
    --info: #7db7ff;
    --danger: #ef7181;

    --text-primary: #f3efd1;
    --text-strong: #ffffff;
    --text-muted: #aeb2b3;
    --text-subtle: #777f82;

    --border-subtle: rgba(221, 217, 181, .10);
    --border-default: rgba(221, 217, 181, .16);
    --border-gold: rgba(247, 210, 126, .32);

    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 20px;
    --space-6: 24px;
    --space-8: 32px;
    --space-10: 40px;
    --space-12: 48px;
    --space-16: 64px;
    --space-20: 80px;
    --space-24: 96px;
    --space-32: 128px;
    --space-40: 160px;

    --radius-pixel: 2px;
    --radius-control: 10px;
    --radius-card: 20px;
    --radius-panel: 24px;
    --radius-pill: 999px;

    --shadow-card:
      0 24px 64px rgba(0, 0, 0, .34),
      inset 0 1px rgba(255, 255, 255, .035);

    --shadow-gold:
      0 16px 50px rgba(247, 210, 126, .12);

    --duration-fast: 140ms;
    --duration-normal: 220ms;
    --duration-slow: 420ms;
    --duration-section: 620ms;

    --ease-out: cubic-bezier(.16, 1, .3, 1);
    --ease-snap: cubic-bezier(.22, 1.5, .36, 1);

    --container: 1440px;
    --content: 760px;
    --docs-sidebar: 280px;
    --docs-toc: 240px;
    --header: 72px;
  }
}
```

---

# 28. Regras para o logo

## 28.1. Variantes necessárias

Criar a partir do ativo:

- lockup horizontal;
- símbolo sem terminal;
- terminal `.JIT`;
- favicon;
- app icon;
- monocromático;
- versão sem glow;
- versão para fundo claro;
- sprite do mascote;
- OG image.

## 28.2. Clear space

Usar no mínimo a largura de um “pixel lógico” grande do mascote em todos os lados.

## 28.3. Fundo

Preferir:

- `#151822`;
- `#0D1018`;
- superfícies grafite.

Evitar fundos:

- amarelos;
- bege muito próximo ao fantasma;
- imagens excessivamente detalhadas.

---

# 29. Conteúdo da landing

## 29.1. Mensagens obrigatórias

A landing precisa responder:

1. O que a JIT compila?
2. Qual código ela gera?
3. Qual é o custo inicial?
4. Como o resultado é reutilizado?
5. Como funciona o modo ahead-of-time?
6. Quais runtimes são suportados?
7. Como a tipagem é inferida?
8. Quais operações existem?
9. Como os benchmarks foram feitos?
10. Qual é o estado de estabilidade da API?

## 29.2. Evitar claims absolutos

Não usar:

- “the fastest” sem escopo;
- “zero cost” sem explicar o que está sendo medido;
- “10,000x faster” sem metodologia;
- “works everywhere” sem matriz de runtimes;
- “no overhead” sem separar build, compile e execution.

---

# 30. Documentos relacionados

Este arquivo deve ser usado junto de:

- `jit-website-agent-implementation-guide.md`;
- documentação real da API;
- benchmark methodology;
- brand assets;
- content inventory;
- changelog da biblioteca.

---

# 31. Referências técnicas oficiais

- Astro Islands: https://docs.astro.build/en/concepts/islands/
- Astro images: https://docs.astro.build/en/guides/images/
- Astro content collections: https://docs.astro.build/en/guides/content-collections/
- Astro view transitions: https://docs.astro.build/en/guides/view-transitions/
- Astro sitemap: https://docs.astro.build/en/guides/integrations-guide/sitemap/
- Starlight: https://starlight.astro.build/
- Motion: https://motion.dev/
- Google SEO Starter Guide: https://developers.google.com/search/docs/fundamentals/seo-starter-guide
- Google Search Essentials: https://developers.google.com/search/docs/essentials
- Web Vitals: https://web.dev/articles/vitals
- JetBrains Mono: https://www.jetbrains.com/lp/mono/

---

# 32. Decisão final de linguagem visual

A JIT usará o sistema do InVideo como referência de:

- hierarquia;
- escala;
- composição;
- profundidade;
- apresentação de produto;
- alternância entre texto e demonstração.

A identidade própria será formada por:

- azul-preto do logo;
- marfim do fantasminha;
- dourado `.JIT`;
- terminal grafite;
- pixel grid de 4px;
- mascote como narrador;
- código gerado como elemento visual principal;
- transições fluidas envolvendo elementos 16-bit;
- documentação de alta legibilidade.

O resultado deve parecer uma ferramenta de compilação moderna que encontrou uma linguagem visual memorável — não um template SaaS com um personagem colado por cima.


---

# Apêndice A — Auditoria visual usada como base

# Design System Audit — InVideo.io

> **Página analisada:** https://invideo.io/  
> **Data da análise:** 11 de julho de 2026  
> **Escopo:** landing page pública principal do InVideo, atualmente centrada no produto **Agent One**.  
> **Objetivo:** documentar o sistema visual, os tokens, a estrutura de layout, os componentes, os estados e os padrões de interação necessários para recriar uma interface com a mesma linguagem visual.

---

## 1. Nota sobre precisão

Esta documentação combina três níveis de evidência:

| Sinal | Significado |
|---|---|
| **Confirmado** | Conteúdo, estrutura ou tecnologia identificados diretamente na página ou em fontes externas de inspeção. |
| **Medido visualmente** | Valor aproximado obtido pela proporção dos elementos na interface desktop. Pode variar alguns pixels. |
| **Recomendado** | Token normalizado para reconstruir o sistema de forma consistente, mesmo quando o CSS original não está publicamente exposto. |

A fonte principal identificada para a página é **Inter**. Os valores de cor e dimensão abaixo devem ser tratados como uma reconstrução técnica de alta fidelidade, não como documentação oficial interna do InVideo.

---

# 2. Visão geral da identidade visual

O design atual do InVideo adota uma estética de:

- produto criativo premium;
- software de inteligência artificial;
- direção de arte cinematográfica;
- interface editorial;
- minimalismo escuro;
- painéis inspirados em ferramentas profissionais de vídeo;
- alta densidade visual em demonstrações do produto;
- bastante espaço negativo nas seções institucionais;
- contraste entre superfícies quase pretas e cartões brancos;
- detalhes de interface em cinza, verde, vermelho, azul e violeta.

A landing não se comporta como uma página SaaS convencional baseada apenas em “hero + features + pricing”. Ela simula partes do produto dentro da própria página, usando painéis editoriais, timelines, notebooks, cursores colaborativos, listas de cenas e superfícies que lembram softwares como Figma, Premiere Pro, Linear e ferramentas de produção audiovisual.

---

# 3. Princípios visuais

## 3.1. Conteúdo como protagonista

A maior parte da interface usa cores neutras. As cores fortes aparecem principalmente em:

- mídia;
- avatares;
- estados;
- cursores;
- chips;
- badges;
- previews;
- elementos de ação;
- indicadores de agente.

Isso impede que a interface concorra visualmente com imagens e vídeos.

## 3.2. Contraste editorial

A página alterna entre:

1. fundos escuros com texto claro;
2. superfícies claras que simulam documentos;
3. cartões de demonstração com molduras discretas;
4. mídia em tela cheia ou quase cheia.

## 3.3. Bordas discretas

Os contornos usam baixo contraste e raramente são completamente brancos.

Exemplo recomendado:

```css
border: 1px solid rgba(255, 255, 255, 0.10);
```

Em superfícies claras:

```css
border: 1px solid rgba(17, 17, 17, 0.10);
```

## 3.4. Arredondamento controlado

Os cantos são suaves, mas não excessivamente “fofos”. O sistema parece usar:

- raio pequeno em chips e controles;
- raio médio em botões;
- raio grande em cartões demonstrativos;
- raio muito grande em superfícies de produto.

## 3.5. Motion funcional

As animações ajudam a demonstrar:

- agentes trabalhando;
- mudança de estado;
- colaboração;
- atualização de cenas;
- edição em lote;
- rolagem de logotipos;
- transição entre contextos criativos.

O motion não deve parecer decorativo sem função.

---

# 4. Fontes

## 4.1. Família tipográfica principal

### Inter

**Status:** confirmado por fontes de inspeção externa da página.

```css
font-family:
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

A fonte Inter é usada por sua:

- legibilidade em interfaces;
- boa renderização em tamanhos pequenos;
- aparência técnica e neutra;
- amplitude de pesos;
- compatibilidade com interfaces densas;
- boa leitura de números e labels.

## 4.2. Pesos recomendados

| Token | Peso | Uso |
|---|---:|---|
| `font-weight-regular` | 400 | corpo, descrições e labels secundários |
| `font-weight-medium` | 500 | navegação, tabs, chips e botões |
| `font-weight-semibold` | 600 | títulos de cartão e destaques |
| `font-weight-bold` | 700 | títulos principais |
| `font-weight-extrabold` | 800 | uso pontual em headlines muito grandes |

## 4.3. Escala tipográfica desktop

| Token | Tamanho | Altura de linha | Peso | Uso |
|---|---:|---:|---:|---|
| `display-xl` | `80px` | `0.98` / `78px` | 600–700 | headline principal em telas grandes |
| `display-lg` | `64px` | `1.00` / `64px` | 600–700 | hero em desktop padrão |
| `display-md` | `52px` | `1.04` / `54px` | 600 | títulos de seções principais |
| `heading-xl` | `44px` | `1.08` / `48px` | 600 | títulos editoriais |
| `heading-lg` | `36px` | `1.12` / `40px` | 600 | títulos de bloco |
| `heading-md` | `28px` | `1.18` / `33px` | 600 | títulos de cards maiores |
| `heading-sm` | `22px` | `1.25` / `28px` | 600 | títulos de cards |
| `body-xl` | `20px` | `1.50` / `30px` | 400 | subtítulo do hero |
| `body-lg` | `18px` | `1.55` / `28px` | 400 | texto introdutório |
| `body-md` | `16px` | `1.50` / `24px` | 400 | corpo padrão |
| `body-sm` | `14px` | `1.45` / `20px` | 400–500 | labels, metadata e controles |
| `caption` | `12px` | `1.35` / `16px` | 500 | badges, indicadores e timestamps |
| `micro` | `10px` | `1.20` / `12px` | 500–600 | UI simulada e marcações compactas |

## 4.4. Escala tipográfica tablet

| Token | Tamanho |
|---|---:|
| Hero | `48–56px` |
| Título de seção | `40–44px` |
| Título de card | `22–28px` |
| Corpo destacado | `18px` |
| Corpo normal | `15–16px` |

## 4.5. Escala tipográfica mobile

| Token | Tamanho | Altura de linha |
|---|---:|---:|
| Hero | `38–44px` | `1.02` |
| Título de seção | `32–36px` | `1.08` |
| Título de card | `22–26px` | `1.16` |
| Corpo destacado | `17–18px` | `1.45` |
| Corpo normal | `15–16px` | `1.50` |
| Labels | `12–14px` | `1.35` |

## 4.6. Tracking

| Contexto | Tracking recomendado |
|---|---:|
| Displays grandes | `-0.04em` |
| Headings | `-0.025em` |
| Corpo | `-0.01em` a `0` |
| Labels em caixa alta | `0.06em` |
| Microcopy | `0.01em` |

Exemplo:

```css
.hero-title {
  font-size: clamp(2.5rem, 5.2vw, 5rem);
  line-height: 0.98;
  letter-spacing: -0.04em;
  font-weight: 650;
}
```

---

# 5. Sistema de cores

## 5.1. Paleta principal

A interface é predominantemente monocromática. A paleta abaixo normaliza os tons visualmente presentes.

### Neutros escuros

| Token | Hex recomendado | Uso |
|---|---|---|
| `black-1000` | `#000000` | áreas de mídia e preto absoluto |
| `black-950` | `#050505` | fundo principal |
| `black-900` | `#0A0A0A` | superfícies profundas |
| `gray-950` | `#0F0F10` | cartões escuros |
| `gray-900` | `#151516` | painéis elevados |
| `gray-850` | `#1B1B1D` | inputs e controles |
| `gray-800` | `#222225` | hover de superfícies |
| `gray-750` | `#2B2B2F` | divisores fortes |
| `gray-700` | `#353539` | bordas e ícones desabilitados |

### Neutros médios

| Token | Hex recomendado | Uso |
|---|---|---|
| `gray-600` | `#55555B` | texto muito secundário |
| `gray-500` | `#73737B` | metadata |
| `gray-400` | `#96969E` | texto secundário |
| `gray-350` | `#A8A8AF` | descrições em fundo escuro |
| `gray-300` | `#BDBDC3` | ícones e texto de apoio |
| `gray-250` | `#CECED3` | borda clara |
| `gray-200` | `#DEDEE2` | superfícies claras secundárias |

### Neutros claros

| Token | Hex recomendado | Uso |
|---|---|---|
| `gray-100` | `#EFEFF1` | fundo claro suave |
| `gray-50` | `#F7F7F8` | documentos e cartões claros |
| `white` | `#FFFFFF` | texto principal e superfícies brancas |

## 5.2. Tokens semânticos

| Token | Valor | Aplicação |
|---|---|---|
| `background-primary` | `#050505` | fundo global |
| `background-secondary` | `#0A0A0A` | seções e cards |
| `surface-1` | `#0F0F10` | primeiro nível elevado |
| `surface-2` | `#151516` | segundo nível elevado |
| `surface-3` | `#1B1B1D` | controles |
| `surface-hover` | `#222225` | hover |
| `surface-inverse` | `#F7F7F8` | documento claro |
| `text-primary` | `#FFFFFF` | texto principal |
| `text-secondary` | `#BDBDC3` | texto de apoio |
| `text-tertiary` | `#96969E` | metadata |
| `text-disabled` | `#55555B` | estado desabilitado |
| `text-inverse` | `#111113` | texto em superfície clara |
| `border-subtle` | `rgba(255,255,255,.10)` | borda padrão |
| `border-medium` | `rgba(255,255,255,.16)` | borda destacada |
| `border-strong` | `rgba(255,255,255,.26)` | foco e seleção |

## 5.3. Cores de ação e estado

A página usa cores de destaque principalmente dentro das demonstrações do produto.

| Token | Hex recomendado | Uso |
|---|---|---|
| `accent-violet` | `#7C5CFC` | IA, seleção, estados criativos |
| `accent-purple` | `#9B6CFF` | gradientes e glow |
| `accent-blue` | `#4C8DFF` | cursores e colaboração |
| `accent-cyan` | `#36C5F0` | informação |
| `accent-green` | `#3CCB7F` | aplicado, concluído, online |
| `accent-lime` | `#A3E635` | destaque experimental |
| `accent-yellow` | `#F4C95D` | atenção e status |
| `accent-orange` | `#FF9657` | atividade |
| `accent-red` | `#F05A67` | gravação, erro ou parada |
| `accent-pink` | `#EB6FBA` | avatares e elementos colaborativos |

## 5.4. Fundos translúcidos

```css
--overlay-soft: rgba(255, 255, 255, 0.04);
--overlay-default: rgba(255, 255, 255, 0.07);
--overlay-hover: rgba(255, 255, 255, 0.10);
--overlay-active: rgba(255, 255, 255, 0.14);
--overlay-inverse: rgba(0, 0, 0, 0.08);
--scrim: rgba(0, 0, 0, 0.62);
```

## 5.5. Gradientes

A linguagem visual não depende de gradientes multicoloridos em grandes superfícies. Eles aparecem de maneira contida em:

- luz ambiente;
- vídeos;
- halos;
- fundos de mídia;
- acentos de IA.

### Gradiente de glow recomendado

```css
background:
  radial-gradient(
    60% 60% at 50% 35%,
    rgba(124, 92, 252, 0.20) 0%,
    rgba(124, 92, 252, 0.06) 45%,
    rgba(5, 5, 5, 0) 75%
  );
```

### Gradiente de scrim sobre mídia

```css
background:
  linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.02) 45%,
    rgba(0, 0, 0, 0.76) 100%
  );
```

---

# 6. Contraste

## 6.1. Regras

- Texto principal claro sobre fundo escuro: contraste alto.
- Texto secundário nunca deve ficar abaixo de aproximadamente `#96969E`.
- Metadata pequena deve usar no mínimo `14px` quando o contraste for baixo.
- Textos sobre imagens devem receber scrim.
- Bordas não podem ser o único sinal de foco.
- O estado selecionado deve combinar borda, fundo e/ou indicador.

## 6.2. Exemplos

```css
.text-primary {
  color: #ffffff;
}

.text-secondary {
  color: #bdbdc3;
}

.text-tertiary {
  color: #96969e;
}
```

---

# 7. Sistema de espaçamento

A página usa um sistema próximo de uma base de **4px**, com predominância de múltiplos de 8.

## 7.1. Escala

| Token | Valor |
|---|---:|
| `space-0` | `0px` |
| `space-1` | `4px` |
| `space-2` | `8px` |
| `space-3` | `12px` |
| `space-4` | `16px` |
| `space-5` | `20px` |
| `space-6` | `24px` |
| `space-7` | `28px` |
| `space-8` | `32px` |
| `space-10` | `40px` |
| `space-12` | `48px` |
| `space-14` | `56px` |
| `space-16` | `64px` |
| `space-20` | `80px` |
| `space-24` | `96px` |
| `space-28` | `112px` |
| `space-32` | `128px` |
| `space-40` | `160px` |
| `space-48` | `192px` |

## 7.2. Espaçamento vertical de seções

| Contexto | Desktop | Tablet | Mobile |
|---|---:|---:|---:|
| Hero: topo | `120–152px` | `104px` | `88–96px` |
| Hero: base | `96–128px` | `80px` | `64–72px` |
| Seção padrão | `128–160px` | `96–120px` | `72–88px` |
| Entre título e conteúdo | `48–72px` | `40–56px` | `32–40px` |
| Entre cards | `20–32px` | `16–24px` | `16px` |
| Footer: topo | `96–128px` | `80px` | `64px` |

---

# 8. Grid e containers

## 8.1. Container principal

```css
.page-container {
  width: min(100% - 48px, 1440px);
  margin-inline: auto;
}
```

### Valores recomendados

| Breakpoint | Largura máxima | Padding lateral |
|---|---:|---:|
| ≥ 1600px | `1440px` | `48–64px` |
| 1280–1599px | `1240–1360px` | `40–48px` |
| 1024–1279px | `960–1120px` | `32px` |
| 768–1023px | `calc(100% - 48px)` | `24px` |
| < 768px | `calc(100% - 32px)` | `16px` |

## 8.2. Grid desktop

- 12 colunas;
- gutter de `24px`;
- margens fluidas;
- largura de conteúdo limitada;
- cards amplos frequentemente ocupam de 6 a 12 colunas.

```css
.grid {
  display: grid;
  grid-template-columns: repeat(12, minmax(0, 1fr));
  gap: 24px;
}
```

## 8.3. Grid tablet

- 8 colunas;
- gutter de `20–24px`.

## 8.4. Grid mobile

- 4 colunas;
- gutter de `16px`.

## 8.5. Proporções recorrentes

| Composição | Proporção |
|---|---|
| Texto + demonstração | `4/8` ou `5/7` |
| Dois cards equivalentes | `6/6` |
| Card em destaque | `8/4` |
| Cards editoriais | `7/5` |
| Mídia horizontal | `16:9`, `3:2` ou proporção customizada ampla |
| Preview vertical | `9:16` |

---

# 9. Breakpoints

```css
--breakpoint-xs: 360px;
--breakpoint-sm: 480px;
--breakpoint-md: 768px;
--breakpoint-lg: 1024px;
--breakpoint-xl: 1280px;
--breakpoint-2xl: 1440px;
--breakpoint-3xl: 1600px;
```

## Comportamento esperado

### Desktop grande

- navegação completa;
- hero com headline ampla;
- demonstrações ocupando quase toda a largura;
- múltiplas colunas;
- motion e efeitos completos.

### Desktop padrão

- conteúdo centralizado;
- grid de 12 colunas;
- títulos entre `56–72px`;
- painéis com altura generosa.

### Tablet

- menu parcialmente simplificado;
- grids de duas colunas mantidos onde houver espaço;
- cartões complexos passam a usar proporções mais altas;
- demos internas podem ser escaladas.

### Mobile

- navegação compacta;
- pilha de uma coluna;
- elementos de UI demonstrativa com overflow controlado;
- partes menos importantes podem ser ocultadas;
- headline com largura máxima;
- CTAs em largura total ou quase total;
- logos em carrossel horizontal.

---

# 10. Raios de borda

| Token | Valor | Uso |
|---|---:|---|
| `radius-xs` | `4px` | indicadores, segmentos |
| `radius-sm` | `6px` | tags pequenas |
| `radius-md` | `8px` | inputs e chips |
| `radius-lg` | `12px` | botões e cards compactos |
| `radius-xl` | `16px` | cards padrão |
| `radius-2xl` | `20px` | painéis |
| `radius-3xl` | `24px` | demos principais |
| `radius-4xl` | `32px` | superfícies hero |
| `radius-pill` | `999px` | pills e avatares circulares |

### Distribuição visual provável

- botão primário: `10–12px`;
- chips: `999px`;
- card de feature: `20–24px`;
- tela simulada: `20–28px`;
- avatar: círculo perfeito.

---

# 11. Bordas

## 11.1. Tokens

```css
--border-subtle: 1px solid rgba(255, 255, 255, 0.08);
--border-default: 1px solid rgba(255, 255, 255, 0.12);
--border-emphasis: 1px solid rgba(255, 255, 255, 0.20);
--border-inverse: 1px solid rgba(17, 17, 19, 0.12);
```

## 11.2. Divisores

```css
.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.08);
}
```

## 11.3. Focus ring

```css
:focus-visible {
  outline: 2px solid #7c5cfc;
  outline-offset: 3px;
}
```

---

# 12. Sombras e elevação

A página usa sombras discretas nas superfícies escuras. A separação entre níveis vem mais de contraste tonal e bordas do que de sombras pesadas.

| Token | Valor |
|---|---|
| `shadow-sm` | `0 4px 12px rgba(0,0,0,.20)` |
| `shadow-md` | `0 12px 32px rgba(0,0,0,.28)` |
| `shadow-lg` | `0 24px 64px rgba(0,0,0,.36)` |
| `shadow-xl` | `0 40px 100px rgba(0,0,0,.45)` |
| `shadow-inset` | `inset 0 1px rgba(255,255,255,.06)` |

### Card elevado

```css
box-shadow:
  0 24px 64px rgba(0, 0, 0, 0.36),
  inset 0 1px rgba(255, 255, 255, 0.05);
```

---

# 13. Ícones

## 13.1. Estilo

- outline;
- espessura entre `1.5px` e `2px`;
- cantos arredondados;
- geometria simples;
- tamanho compacto;
- baixa complexidade visual.

## 13.2. Medidas

| Contexto | Tamanho |
|---|---:|
| Ícone inline | `14–16px` |
| Controle padrão | `18–20px` |
| Botão com ícone | `20px` |
| Feature | `24–28px` |
| Destaque | `32px` |

## 13.3. Biblioteca equivalente

Para reconstrução, podem ser usadas:

- Lucide;
- Phosphor;
- Radix Icons;
- ícones próprios para timeline, agentes e edição.

Lucide com `stroke-width: 1.75` é uma aproximação adequada.

---

# 14. Navegação principal

## 14.1. Estrutura observada

A navegação contém grupos como:

- InVideo AI;
- ferramentas de criação;
- plataformas;
- recursos de IA;
- InVideo Studio;
- recursos;
- pricing;
- enterprise;
- login;
- sign up.

## 14.2. Medidas recomendadas

| Propriedade | Valor |
|---|---:|
| Altura do header | `72–80px` |
| Padding horizontal | `32–48px` |
| Logo | `104–126px` de largura |
| Gap entre links | `24–32px` |
| Texto | `14px`, peso `500` |
| Botão | `40–44px` de altura |
| Raio do botão | `10–12px` |

## 14.3. Comportamento

- fundo preto ou quase preto;
- possível transparência inicial;
- versão sólida ao rolar;
- dropdowns amplos, organizados por grupos;
- suporte a mega menu;
- hover com texto mais claro;
- transição de `150–200ms`.

## 14.4. Header sticky

```css
.site-header {
  position: sticky;
  top: 0;
  z-index: 100;
  height: 76px;
  backdrop-filter: blur(18px);
  background: rgba(5, 5, 5, 0.82);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
```

---

# 15. Hero

## 15.1. Estrutura

O hero contém:

1. headline principal;
2. texto explicativo;
3. CTA primário;
4. seletor de casos de uso;
5. demonstração complexa do produto;
6. composição com usuários e agentes;
7. mídia e listas de cenas.

## 15.2. Conteúdo central

A headline atual comunica que o InVideo é uma plataforma de vídeo com IA para criativos profissionais.

## 15.3. Medidas recomendadas

| Propriedade | Desktop | Mobile |
|---|---:|---:|
| Largura máxima da headline | `900–1050px` | `100%` |
| Tamanho da headline | `64–80px` | `38–44px` |
| Largura do subtítulo | `620–720px` | `100%` |
| Tamanho do subtítulo | `18–20px` | `16–18px` |
| Gap título/subtítulo | `24px` | `20px` |
| Gap subtítulo/CTA | `32px` | `28px` |
| Botão | `48–52px` altura | `48px` |
| Espaço até a demo | `64–88px` | `48–56px` |

## 15.4. CTA primário

Visual recomendado:

- fundo branco;
- texto preto;
- ícone opcional;
- padding horizontal de `22–28px`;
- altura de `48–52px`;
- raio de `10–12px`;
- peso `600`.

```css
.button-primary {
  min-height: 50px;
  padding: 0 26px;
  border-radius: 12px;
  background: #ffffff;
  color: #0a0a0a;
  font-weight: 600;
}
```

### Hover

```css
.button-primary:hover {
  background: #efeff1;
  transform: translateY(-1px);
}
```

## 15.5. Seletor de casos de uso

Itens observados:

- Film Promo;
- Performance Ad;
- Product Ad;
- Microdrama.

### Medidas

- texto: `13–14px`;
- gap: `8–12px`;
- altura: `32–36px`;
- padding: `8px 12px`;
- borda em item ativo;
- layout horizontal com wrap ou scroll no mobile.

---

# 16. Demonstração principal do produto

A demonstração do hero é o elemento visual mais complexo.

## 16.1. Estrutura conceitual

- moldura externa;
- área de interação “You”;
- agente trabalhando;
- painel de contexto;
- navegação interna;
- lista de clips;
- lista de imagens;
- estado de processamento;
- botão de parar;
- elementos de mídia;
- avatares ou iniciais.

## 16.2. Dimensões

| Propriedade | Valor aproximado |
|---|---:|
| Largura | `1100–1360px` |
| Altura | `650–820px` |
| Raio externo | `24–32px` |
| Borda | `1px` translúcida |
| Padding interno | `16–24px` |
| Barra superior | `48–56px` |
| Sidebar | `220–280px` |
| Painel central | flexível |
| Coluna lateral | `240–320px` |

## 16.3. Superfícies

- moldura: `#0A0A0A`;
- painel: `#0F0F10`;
- controle: `#1B1B1D`;
- seleção: overlay branco entre 8% e 14%;
- documento claro: `#F7F7F8`;
- texto escuro: `#111113`.

## 16.4. Estratégia responsiva

Em vez de reconstruir toda a UI em mobile:

- manter aspect ratio;
- escalar o painel para `85–92%`;
- ocultar colunas secundárias;
- permitir overflow horizontal controlado;
- usar uma composição simplificada específica para mobile;
- evitar texto inferior a `10px`.

---

# 17. Faixa de logotipos

## 17.1. Estrutura

A faixa “Trusted by teams at” apresenta marcas em uma linha contínua, com repetição para criar movimento infinito.

## 17.2. Medidas

| Propriedade | Valor |
|---|---:|
| Altura da faixa | `96–128px` |
| Logo máximo | `88–126px × 24–34px` |
| Gap | `48–72px` |
| Opacidade padrão | `0.55–0.75` |
| Opacidade hover | `1` |
| Velocidade do marquee | `28–45s` por ciclo |

## 17.3. Motion

```css
@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
```

Respeitar:

```css
@media (prefers-reduced-motion: reduce) {
  .logo-track {
    animation: none;
  }
}
```

---

# 18. Seção “Never repeat yourself”

## 18.1. Objetivo

Explicar memória de longo prazo e consistência de projeto.

## 18.2. Estrutura

- título;
- descrição;
- link textual;
- painel semelhante a notebook;
- composição bloqueada;
- variações de cenários;
- estado do agente analisando;
- confirmação “Applied”.

## 18.3. Layout

Em desktop:

- texto ocupa aproximadamente 4 colunas;
- demonstração ocupa 8 colunas;
- ou título em largura completa seguido de demo.

## 18.4. Card “Notebook”

| Propriedade | Valor |
|---|---:|
| Fundo | `#F7F7F8` |
| Texto | `#111113` |
| Raio | `20–24px` |
| Padding | `24–32px` |
| Borda | `rgba(17,17,19,.10)` |
| Sombra | `0 24px 64px rgba(0,0,0,.28)` |

---

# 19. Seção de edição em lote

## 19.1. Título

“Edit multiple shots in one go”.

O título usa quebra de linha editorial deliberada.

## 19.2. Componentes

- título grande;
- descrição;
- indicador “Active agents”;
- chips de agente;
- preview de edição;
- status visual.

## 19.3. Chips

```css
.agent-chip {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05);
  font-size: 13px;
  font-weight: 500;
}
```

### Círculo de status

- `6–8px`;
- verde para ativo;
- animação de pulso opcional.

---

# 20. Seção “No need to become a prompt engineer”

## 20.1. Estrutura

- texto editorial;
- CTA textual;
- painel do Agent One;
- estado “Reading prompt guide...”;
- grade de imagens ou referências;
- indicação de processamento.

## 20.2. CTA textual

```css
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #ffffff;
  font-weight: 500;
  text-decoration: none;
}
```

Hover:

- deslocar seta `2–4px`;
- reduzir opacidade do texto para 90%;
- duração `180ms`.

---

# 21. Seção “Helping creatives stay creative”

Esta seção apresenta várias capacidades dentro de uma composição de cards.

## 21.1. Capacidades identificadas

- Multiplayer mode;
- Storyboarding;
- Script writing;
- Timeline editor;
- Build your own agents.

## 21.2. Grid editorial

Sugestão desktop:

```text
┌─────────────────────┬─────────────────────┐
│ Multiplayer         │ Storyboarding       │
│ card grande         │ card médio          │
├─────────────────────┼──────────┬──────────┤
│ Timeline editor     │ Script   │ Agents   │
│ card amplo          │ writing  │ builder  │
└─────────────────────┴──────────┴──────────┘
```

## 21.3. Card padrão

| Propriedade | Valor |
|---|---:|
| Fundo | `#0F0F10` |
| Borda | `rgba(255,255,255,.08)` |
| Raio | `20–24px` |
| Padding | `24–32px` |
| Altura mínima | `320–420px` |
| Gap entre título e texto | `10–14px` |
| Título | `20–24px` |
| Corpo | `15–16px` |

## 21.4. Multiplayer

Elementos:

- cursores coloridos;
- avatares;
- nomes;
- cargos;
- comentários;
- timestamps;
- caixa de mensagem;
- indicação de presença.

### Cursor colaborativo

- cursor: `16–20px`;
- label: `24–30px` de altura;
- padding: `6px 9px`;
- raio: `6px`;
- cor individual por usuário.

## 21.5. Storyboarding

- preview de imagem;
- sequência de frames;
- labels de cena;
- área de edição;
- fundo escuro;
- detalhes claros.

## 21.6. Script writing

- card mais textual;
- linhas de script;
- caret;
- sugestões de IA;
- controles discretos.

## 21.7. Timeline editor

- régua temporal;
- timecodes;
- clips;
- waveform ou blocos;
- playhead;
- labels truncados.

### Medidas

| Elemento | Valor |
|---|---:|
| Altura da timeline | `160–220px` |
| Régua | `28–36px` |
| Track | `36–48px` |
| Playhead | `1–2px` |
| Handle | `8–12px` |
| Timecode | `10–12px` |

## 21.8. Build your own agents

- lista horizontal ou grade;
- avatar circular;
- nome;
- função;
- repetição para sugerir variedade.

Avatar:

- `32–40px`;
- círculo;
- fundo colorido ou imagem;
- texto `12–14px`.

---

# 22. Seção de casos de uso

## 22.1. Título

“Think bigger and sweat less with videos”.

## 22.2. Categorias

- Filmmaking;
- Advertising;
- Microdrama;
- Social media.

## 22.3. Estrutura

Pode ser implementada como:

- tabs;
- cards horizontais;
- accordion em mobile;
- painel ativo com mídia e descrição.

## 22.4. Tabs

| Propriedade | Valor |
|---|---:|
| Altura | `44–48px` |
| Texto | `14–16px` |
| Peso | `500–600` |
| Gap | `8px` |
| Indicador | borda, fundo ou underline |
| Transição | `180–240ms` |

---

# 23. Bloco enterprise e confiança

## 23.1. Conteúdo

A página comunica:

- uso individual e empresarial;
- privacidade;
- segurança;
- alinhamento SOC 2 e ISO;
- conformidade com GDPR;
- investidores;
- marcas de referência.

## 23.2. Badge de confiança

```css
.trust-badge {
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 999px;
  color: #bdbdc3;
  font-size: 12px;
  font-weight: 500;
}
```

---

# 24. Pricing

## 24.1. Estrutura observada

- título “Pricing”;
- seletor entre Individual e Team & Enterprise;
- lista do que está incluído;
- acesso a modelos;
- provedores de stock;
- créditos;
- CTA.

## 24.2. Segmented control

| Propriedade | Valor |
|---|---:|
| Altura | `44–48px` |
| Padding externo | `4px` |
| Raio | `12–14px` |
| Fundo | `#151516` |
| Item ativo | `#FFFFFF` ou overlay elevado |
| Texto ativo | `#0A0A0A` |
| Texto inativo | `#BDBDC3` |

## 24.3. Cards de plano

Mesmo que a página possa carregar os detalhes dinamicamente, o padrão recomendado é:

| Propriedade | Valor |
|---|---:|
| Largura | `360–420px` |
| Padding | `28–36px` |
| Raio | `20–24px` |
| Borda | `1px solid rgba(255,255,255,.10)` |
| Gap interno | `24px` |
| CTA | largura completa |
| Destaque | borda ou glow violeta sutil |

---

# 25. Footer

## 25.1. Estrutura

O footer contém grupos extensos de links:

- ferramentas de vídeo;
- modelos de vídeo;
- ferramentas de imagem;
- modelos de imagem;
- áudio e música;
- ferramentas rápidas;
- InVideo Studio;
- ajuda;
- aplicativos;
- políticas;
- copyright.

## 25.2. Layout desktop

- 5 a 7 colunas;
- título de grupo;
- links verticais;
- área de app stores;
- logo;
- linha legal.

## 25.3. Medidas

| Propriedade | Valor |
|---|---:|
| Padding superior | `96–128px` |
| Padding inferior | `40–56px` |
| Gap entre colunas | `32–56px` |
| Título da coluna | `14px`, peso `600` |
| Link | `13–14px` |
| Gap entre links | `10–14px` |
| Linha legal | `12–13px` |
| Logo | `100–120px` |

## 25.4. Mobile

- accordion por grupo;
- divisores;
- app badges empilhados ou lado a lado;
- políticas com wrap;
- padding lateral de `16px`.

---

# 26. Botões

## 26.1. Variantes

### Primary

- fundo branco;
- texto preto;
- contraste máximo.

### Secondary

- fundo translúcido;
- texto branco;
- borda sutil.

### Ghost

- sem fundo;
- hover translúcido.

### Text link

- sem moldura;
- seta;
- animação horizontal curta.

## 26.2. Tamanhos

| Tamanho | Altura | Padding horizontal | Texto |
|---|---:|---:|---:|
| `sm` | `36px` | `14px` | `13px` |
| `md` | `44px` | `18px` | `14px` |
| `lg` | `50px` | `24–28px` | `15–16px` |

## 26.3. Estados

### Hover

- mudança de fundo entre 4% e 8%;
- `translateY(-1px)`;
- sombra discreta.

### Active

- `translateY(0)`;
- redução de brilho;
- escala opcional `0.99`.

### Focus

- outline violeta;
- offset de `3px`.

### Disabled

- opacidade `0.4`;
- cursor `not-allowed`;
- sem transform.

---

# 27. Inputs e campos

Embora a landing use poucos formulários convencionais, as demos mostram campos e áreas de prompt.

## 27.1. Campo padrão

| Propriedade | Valor |
|---|---:|
| Altura | `44–48px` |
| Padding horizontal | `14–16px` |
| Fundo | `#151516` |
| Borda | `rgba(255,255,255,.10)` |
| Raio | `10–12px` |
| Texto | `14px` |
| Placeholder | `#73737B` |

## 27.2. Prompt composer

| Propriedade | Valor |
|---|---:|
| Altura mínima | `112–160px` |
| Padding | `16–20px` |
| Raio | `16–20px` |
| Footer interno | `40–48px` |
| Botão enviar | `36–40px` |
| Attachment | `32–36px` |

---

# 28. Chips, tags e badges

## 28.1. Pill

```css
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 11px;
  border-radius: 999px;
  background: rgba(255,255,255,.06);
  border: 1px solid rgba(255,255,255,.09);
  color: #bdbdc3;
  font-size: 12px;
  font-weight: 500;
}
```

## 28.2. Badge de status

- altura `22–26px`;
- texto `10–12px`;
- dot `6px`;
- fundo da cor com opacidade entre 10% e 16%;
- texto da cor em tom mais claro.

---

# 29. Avatares

| Tamanho | Uso |
|---|---|
| `20px` | participantes compactos |
| `24px` | lista |
| `32px` | comentários |
| `40px` | cards |
| `48px` | destaque |

### Stack de avatares

```css
.avatar + .avatar {
  margin-left: -8px;
}
```

Cada avatar deve ter uma borda do fundo:

```css
border: 2px solid #0f0f10;
```

---

# 30. Estados de processamento de IA

## 30.1. Estados

- idle;
- reading;
- analysing;
- thinking;
- generating;
- applying;
- completed;
- stopped;
- failed.

## 30.2. Componente de atividade

Elementos:

- avatar do agente;
- título do estado;
- lista de tarefas;
- item ativo;
- itens concluídos;
- spinner;
- botão “Stop”.

## 30.3. Spinner

- `14–18px`;
- borda `2px`;
- duração `700–900ms`;
- easing linear.

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

## 30.4. Lista de progresso

- gap `8–10px`;
- texto `12–14px`;
- item concluído em `#96969E`;
- item ativo em branco;
- check verde;
- dot pulsante.

---

# 31. Motion system

## 31.1. Durações

| Token | Valor | Uso |
|---|---:|---|
| `duration-instant` | `100ms` | pressão e feedback imediato |
| `duration-fast` | `160ms` | hover |
| `duration-normal` | `220ms` | tabs e dropdowns |
| `duration-slow` | `360ms` | cards e painéis |
| `duration-enter` | `520ms` | entrada de seção |
| `duration-ambient` | `8–45s` | marquee e movimentos contínuos |

## 31.2. Easings

```css
--ease-standard: cubic-bezier(0.2, 0, 0, 1);
--ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
--ease-exit: cubic-bezier(0.4, 0, 1, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

## 31.3. Entrada de seção

```css
.section-reveal {
  opacity: 0;
  transform: translateY(24px);
  transition:
    opacity 520ms var(--ease-enter),
    transform 520ms var(--ease-enter);
}
```

## 31.4. Parallax

Usar apenas em:

- mídia de hero;
- glow;
- backgrounds;
- cards amplos.

Deslocamento máximo recomendado: `12–32px`.

## 31.5. Reduced motion

Todo movimento importante deve ter alternativa estática.

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

# 32. Responsividade detalhada

## 32.1. Header

### Desktop

- logo à esquerda;
- navegação central;
- autenticação à direita.

### Tablet

- links menos importantes podem entrar no menu;
- manter CTA principal.

### Mobile

- logo;
- CTA opcional compacto;
- botão de menu;
- drawer em tela inteira ou quase inteira.

## 32.2. Hero

### Desktop

- texto centralizado;
- headline ampla;
- demo completa.

### Mobile

- alinhamento central ou à esquerda;
- tabs horizontais com scroll;
- demonstração simplificada;
- evitar miniaturizar a interface inteira até ficar ilegível.

## 32.3. Cards

- 3 colunas → 2 colunas → 1 coluna;
- preservar hierarquia;
- manter cards principais antes dos secundários.

## 32.4. Footer

- colunas → accordions;
- links com área de toque mínima de `44px` quando agrupados;
- divisores visíveis.

---

# 33. Acessibilidade

## 33.1. Navegação por teclado

- todos os controles devem ser alcançáveis por Tab;
- dropdowns devem suportar Escape;
- tabs devem suportar setas;
- menu mobile deve prender foco;
- ao fechar modal ou menu, devolver foco ao gatilho.

## 33.2. Áreas de toque

Mínimo recomendado:

```text
44 × 44px
```

## 33.3. Imagens e vídeos

- `alt` descritivo em imagens informativas;
- `alt=""` em decoração;
- captions em vídeos;
- botão de pausa em animações extensas;
- evitar autoplay com áudio.

## 33.4. Texto

- corpo mínimo de `16px` em mobile;
- não depender apenas de cor;
- limitar linhas entre `55–75ch`.

## 33.5. Foco

Focus ring sempre visível:

```css
outline: 2px solid #7c5cfc;
outline-offset: 3px;
```

---

# 34. Arquitetura de componentes

## 34.1. Foundations

```text
foundations/
├── colors
├── typography
├── spacing
├── radii
├── shadows
├── borders
├── breakpoints
├── motion
└── z-index
```

## 34.2. Primitives

```text
primitives/
├── Box
├── Stack
├── Inline
├── Grid
├── Container
├── Text
├── Heading
├── Icon
├── Button
├── IconButton
├── Link
├── Badge
├── Chip
├── Avatar
├── Divider
└── Surface
```

## 34.3. Components

```text
components/
├── Header
├── MegaMenu
├── MobileNavigation
├── Hero
├── UseCaseTabs
├── ProductDemo
├── AgentActivity
├── SceneList
├── MediaGrid
├── LogoMarquee
├── FeatureSection
├── NotebookPanel
├── CollaborationCard
├── CommentThread
├── StoryboardCard
├── ScriptEditorCard
├── TimelineCard
├── AgentRoster
├── UseCaseShowcase
├── TrustBadges
├── PricingSelector
├── PricingCard
├── Footer
└── StoreBadges
```

## 34.4. Composições

```text
sections/
├── HeroSection
├── TrustedCompaniesSection
├── MemorySection
├── BatchEditingSection
├── PromptingSection
├── CreativeToolsSection
├── UseCasesSection
├── EnterpriseSection
├── PricingSection
└── FooterSection
```

---

# 35. Tokens CSS sugeridos

```css
:root {
  /* Colors */
  --color-bg-primary: #050505;
  --color-bg-secondary: #0a0a0a;
  --color-surface-1: #0f0f10;
  --color-surface-2: #151516;
  --color-surface-3: #1b1b1d;
  --color-surface-hover: #222225;
  --color-surface-inverse: #f7f7f8;

  --color-text-primary: #ffffff;
  --color-text-secondary: #bdbdc3;
  --color-text-tertiary: #96969e;
  --color-text-disabled: #55555b;
  --color-text-inverse: #111113;

  --color-border-subtle: rgba(255, 255, 255, 0.08);
  --color-border-default: rgba(255, 255, 255, 0.12);
  --color-border-emphasis: rgba(255, 255, 255, 0.20);

  --color-accent-violet: #7c5cfc;
  --color-accent-purple: #9b6cff;
  --color-accent-blue: #4c8dff;
  --color-accent-cyan: #36c5f0;
  --color-accent-green: #3ccb7f;
  --color-accent-yellow: #f4c95d;
  --color-accent-orange: #ff9657;
  --color-accent-red: #f05a67;
  --color-accent-pink: #eb6fba;

  /* Typography */
  --font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;

  --text-display-xl: 5rem;
  --text-display-lg: 4rem;
  --text-display-md: 3.25rem;
  --text-heading-xl: 2.75rem;
  --text-heading-lg: 2.25rem;
  --text-heading-md: 1.75rem;
  --text-heading-sm: 1.375rem;
  --text-body-xl: 1.25rem;
  --text-body-lg: 1.125rem;
  --text-body-md: 1rem;
  --text-body-sm: 0.875rem;
  --text-caption: 0.75rem;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.25rem;
  --space-6: 1.5rem;
  --space-8: 2rem;
  --space-10: 2.5rem;
  --space-12: 3rem;
  --space-16: 4rem;
  --space-20: 5rem;
  --space-24: 6rem;
  --space-32: 8rem;
  --space-40: 10rem;

  /* Radius */
  --radius-xs: 0.25rem;
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.25rem;
  --radius-3xl: 1.5rem;
  --radius-4xl: 2rem;
  --radius-pill: 999px;

  /* Shadows */
  --shadow-sm: 0 4px 12px rgba(0, 0, 0, 0.20);
  --shadow-md: 0 12px 32px rgba(0, 0, 0, 0.28);
  --shadow-lg: 0 24px 64px rgba(0, 0, 0, 0.36);
  --shadow-xl: 0 40px 100px rgba(0, 0, 0, 0.45);

  /* Motion */
  --duration-fast: 160ms;
  --duration-normal: 220ms;
  --duration-slow: 360ms;
  --duration-enter: 520ms;

  --ease-standard: cubic-bezier(0.2, 0, 0, 1);
  --ease-enter: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-exit: cubic-bezier(0.4, 0, 1, 1);

  /* Layout */
  --container-max: 1440px;
  --header-height: 76px;
}
```

---

# 36. Exemplo de tema em formato TypeScript

```ts
export const theme = {
  colors: {
    background: {
      primary: "#050505",
      secondary: "#0A0A0A",
    },
    surface: {
      1: "#0F0F10",
      2: "#151516",
      3: "#1B1B1D",
      hover: "#222225",
      inverse: "#F7F7F8",
    },
    text: {
      primary: "#FFFFFF",
      secondary: "#BDBDC3",
      tertiary: "#96969E",
      disabled: "#55555B",
      inverse: "#111113",
    },
    border: {
      subtle: "rgba(255,255,255,.08)",
      default: "rgba(255,255,255,.12)",
      emphasis: "rgba(255,255,255,.20)",
    },
    accent: {
      violet: "#7C5CFC",
      purple: "#9B6CFF",
      blue: "#4C8DFF",
      cyan: "#36C5F0",
      green: "#3CCB7F",
      yellow: "#F4C95D",
      orange: "#FF9657",
      red: "#F05A67",
      pink: "#EB6FBA",
    },
  },

  typography: {
    family: {
      sans: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },
  },

  radii: {
    xs: 4,
    sm: 6,
    md: 8,
    lg: 12,
    xl: 16,
    "2xl": 20,
    "3xl": 24,
    "4xl": 32,
    pill: 999,
  },

  breakpoints: {
    xs: 360,
    sm: 480,
    md: 768,
    lg: 1024,
    xl: 1280,
    "2xl": 1440,
    "3xl": 1600,
  },
} as const;
```

---

# 37. Exemplo de estrutura HTML do hero

```html
<section class="hero">
  <div class="page-container hero__content">
    <h1 class="hero__title">
      The AI video platform for serious creatives
    </h1>

    <p class="hero__description">
      Don't waste time on AI you have to babysit. Do what you love while
      AI agents handle the rest.
    </p>

    <a class="button button--primary" href="#">
      Start Creating
    </a>

    <div class="hero__use-cases" role="tablist">
      <button role="tab">Film Promo</button>
      <button role="tab">Performance Ad</button>
      <button role="tab">Product Ad</button>
      <button role="tab">Microdrama</button>
    </div>

    <div class="hero__demo">
      <!-- Product simulation -->
    </div>
  </div>
</section>
```

---

# 38. Exemplo de container responsivo

```css
.page-container {
  width: min(calc(100% - 96px), 1440px);
  margin-inline: auto;
}

@media (max-width: 1279px) {
  .page-container {
    width: min(calc(100% - 64px), 1120px);
  }
}

@media (max-width: 767px) {
  .page-container {
    width: calc(100% - 32px);
  }
}
```

---

# 39. Z-index

| Token | Valor | Uso |
|---|---:|---|
| `z-base` | `0` | conteúdo |
| `z-raised` | `10` | cards sobrepostos |
| `z-sticky` | `100` | header |
| `z-dropdown` | `200` | menus |
| `z-overlay` | `300` | scrim |
| `z-drawer` | `400` | navegação mobile |
| `z-modal` | `500` | modal |
| `z-toast` | `600` | notificações |
| `z-tooltip` | `700` | tooltip |

---

# 40. Padrões de composição

## 40.1. Título editorial

- headline curta;
- largura limitada;
- quebra de linha intencional;
- tracking negativo;
- corpo abaixo com largura menor.

## 40.2. Produto dentro do marketing

A página não usa ilustrações abstratas para explicar cada feature. Ela mostra uma versão estilizada da própria ferramenta.

Ao reproduzir essa abordagem:

- construir demos reais ou mockups com componentes;
- evitar screenshots estáticas quando uma microinteração puder explicar melhor;
- usar dados fictícios coerentes;
- manter consistência entre cenas, nomes e estados.

## 40.3. Alternância de densidade

A página intercala:

1. seção textual limpa;
2. seção demonstrativa densa;
3. respiro;
4. nova demonstração.

Isso reduz fadiga visual.

---

# 41. Conteúdo e tom de voz

## 41.1. Características

- frases curtas;
- linguagem confiante;
- foco em benefício;
- termos do universo criativo;
- pouca linguagem corporativa;
- oposição entre trabalho criativo e trabalho repetitivo;
- CTAs diretos.

## 41.2. Padrão de headline

```text
[Benefício direto]
[sem a tarefa frustrante]
```

Exemplos de estrutura:

- “Never repeat yourself”
- “Edit multiple shots in one go”
- “No need to become a prompt engineer”
- “Helping creatives stay creative”

## 41.3. CTAs

- Start Creating
- Create video
- Add context
- Discover
- Sign up

---

# 42. Checklist para reconstrução

## Fundação

- [ ] Configurar Inter.
- [ ] Criar escala de neutros escuros.
- [ ] Criar tokens semânticos.
- [ ] Adotar grid de 12/8/4 colunas.
- [ ] Criar escala de espaçamento em múltiplos de 4.
- [ ] Criar raios de 4 a 32px.
- [ ] Criar motion tokens.
- [ ] Implementar reduced motion.

## Componentes

- [ ] Header sticky.
- [ ] Mega menu.
- [ ] Hero.
- [ ] Tabs de casos de uso.
- [ ] Botões primary, secondary e ghost.
- [ ] Product demo shell.
- [ ] Agent status.
- [ ] Logo marquee.
- [ ] Cards editoriais.
- [ ] Notebook claro.
- [ ] Cursores colaborativos.
- [ ] Timeline.
- [ ] Pricing selector.
- [ ] Footer responsivo.

## Qualidade

- [ ] Contraste WCAG.
- [ ] Navegação por teclado.
- [ ] Focus rings.
- [ ] Sem textos menores que 12px na página real.
- [ ] Otimizar vídeos e imagens.
- [ ] Lazy loading abaixo da dobra.
- [ ] Evitar layout shift.
- [ ] Testar 360, 768, 1024, 1280, 1440 e 1600px.

---

# 43. Recomendações técnicas

## 43.1. Stack sugerida

- React ou Next.js;
- TypeScript;
- CSS Modules, vanilla-extract, Tailwind ou Panda CSS;
- Framer Motion ou Motion One;
- Radix UI para primitives acessíveis;
- Lucide para ícones;
- Embla para carrosséis;
- CSS scroll-driven animations quando suportado;
- `next/image` ou equivalente para mídia responsiva.

## 43.2. Performance

- vídeos com poster;
- formatos AV1/WebM e fallback MP4;
- imagens AVIF/WebP;
- preload apenas do hero;
- pausar animações fora da viewport;
- não montar demos complexas antes de entrarem na proximidade da viewport;
- usar `content-visibility: auto`;
- reservar dimensões de mídia;
- dividir componentes pesados por seção.

## 43.3. Exemplo de otimização

```css
.feature-section {
  content-visibility: auto;
  contain-intrinsic-size: 900px;
}
```

---

# 44. Valores essenciais resumidos

| Categoria | Valor principal |
|---|---|
| Fonte | Inter |
| Fundo global | `#050505` |
| Superfície 1 | `#0F0F10` |
| Superfície 2 | `#151516` |
| Texto principal | `#FFFFFF` |
| Texto secundário | `#BDBDC3` |
| Texto terciário | `#96969E` |
| Acento IA | `#7C5CFC` |
| Sucesso | `#3CCB7F` |
| Erro/stop | `#F05A67` |
| Container máximo | `1440px` |
| Header | `72–80px` |
| Padding desktop | `40–64px` |
| Padding mobile | `16px` |
| Grid | `12 / 8 / 4` colunas |
| Gutter desktop | `24px` |
| Gutter mobile | `16px` |
| Raio de cards | `20–24px` |
| Raio de botões | `10–12px` |
| Botão grande | `48–52px` |
| Hero desktop | `64–80px` |
| Hero mobile | `38–44px` |
| Seção desktop | `128–160px` |
| Seção mobile | `72–88px` |
| Motion hover | `160–220ms` |
| Motion de entrada | `360–520ms` |

---

# 45. Fontes da análise

1. Página principal do InVideo:  
   https://invideo.io/

2. Estrutura textual atual da landing, incluindo hero, seções, recursos, pricing e footer:  
   https://invideo.io/

3. Identificação externa da fonte Inter e inventário de tokens associados ao domínio:  
   https://fontofweb.com/tokens/invideo.io  
   https://www.fontofweb.com/pin/6193

> A página pode mudar por testes A/B, região, sessão, resolução, autenticação ou atualização do produto. Para uma reprodução pixel-perfect, os tokens devem ser validados novamente no navegador com DevTools no viewport-alvo.

---

# 46. Conclusão

O sistema visual do InVideo é sustentado por cinco pilares:

1. **base monocromática escura**;
2. **tipografia Inter com headlines grandes e compactas**;
3. **demonstrações de produto altamente detalhadas**;
4. **cards editoriais com bordas e elevação discretas**;
5. **motion orientado a processo e colaboração**.

A fidelidade não depende apenas de copiar cores e raios. O aspecto mais importante é reproduzir a relação entre marketing e produto: cada seção transforma uma feature em uma pequena cena interativa, usando a interface do próprio software como elemento narrativo.
