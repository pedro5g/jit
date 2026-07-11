# Guia de animações do fantasminha da JIT

Este guia explica como animar o mascote da JIT em **SVG** dentro do site em **Next.js**, mantendo o visual 16-bit, boa performance e acessibilidade.

---

# 1. Objetivo

O fantasminha não deve ser apenas decorativo. Ele deve funcionar como um pequeno "guia de compilação" do site.

Ele pode:

- flutuar no hero;
- observar o cursor;
- reagir ao hover em cards;
- apontar para exemplos de código;
- comemorar após uma compilação;
- dormir quando estiver inativo;
- piscar periodicamente;
- aparecer em callouts e blocos da documentação.

A regra principal é:

> a animação deve enriquecer a experiência, nunca atrapalhar leitura, foco, seleção de código ou performance.

---

# 2. Estratégia recomendada

Use uma arquitetura em 3 camadas:

## Camada A — SVG base

O SVG contém a ilustração isolada do mascote.

Use o SVG para:

- corpo;
- face;
- olhos;
- boca;
- bracinho;
- brilho principal.

## Camada B — animações CSS leves

Use CSS para:

- floating idle;
- blink;
- micro inclinação;
- brilho suave;
- opacidade de entrada;
- pequenas reações de hover.

## Camada C — Motion/React

Use Motion for React apenas para:

- seguir o cursor com atraso;
- transições entre estados;
- entrada de seção;
- pequenas sequências narrativas;
- reações a eventos (copy, compile, success, error).

---

# 3. Estrutura recomendada de arquivos

```text
components/
├── brand/
│   ├── JitGhost.tsx
│   ├── JitGhostStatic.tsx
│   ├── JitGhostEyes.tsx
│   └── jit-ghost.module.css
├── motion/
│   ├── useGhostPointer.ts
│   ├── useGhostState.ts
│   └── ghost-events.ts
public/
├── brand/
│   └── jit-ghost.svg
```

---

# 4. Estados do fantasminha

```ts
export type JitGhostState =
  | "idle"
  | "float"
  | "observe"
  | "follow"
  | "point"
  | "typing"
  | "compile"
  | "success"
  | "warning"
  | "error"
  | "sleep";
```

### Descrição dos estados

- `idle`: parado com pequeno movimento respirando.
- `float`: sobe e desce lentamente.
- `observe`: olhos acompanham o cursor.
- `follow`: corpo acompanha levemente o mouse.
- `point`: inclina e estica o braço em direção a algo.
- `typing`: aparece perto de um terminal ou code block.
- `compile`: pequena vibração/energia.
- `success`: bounce curto + brilho.
- `warning`: inclinação curta + cor de atenção.
- `error`: leve recuo.
- `sleep`: animação quase parada, com piscada longa.

---

# 5. Animações essenciais

## 5.1. Floating idle

Essa é a animação principal do hero e da docs.

### CSS

```css
@keyframes ghostFloat {
  0% {
    transform: translate3d(0, 0, 0);
  }
  50% {
    transform: translate3d(0, -8px, 0);
  }
  100% {
    transform: translate3d(0, 0, 0);
  }
}

.float {
  animation: ghostFloat 3.2s ease-in-out infinite;
  will-change: transform;
}
```

### Recomendação

- amplitude: `4px` a `10px`;
- duração: `2.8s` a `4.2s`;
- easing: suave;
- nunca exagerar a flutuação.

---

## 5.2. Blink

O blink deve acontecer só de tempos em tempos.

### Implementação simples

Você pode separar os olhos como um grupo SVG e animar o `scaleY`.

```css
@keyframes ghostBlink {
  0%,
  46%,
  48%,
  100% {
    transform: scaleY(1);
  }

  47% {
    transform: scaleY(0.12);
  }
}

.eyes {
  transform-box: fill-box;
  transform-origin: center;
  animation: ghostBlink 6s linear infinite;
}
```

### Dicas

- intervalo: `4s` a `8s`;
- não sincronizar vários fantasmas na mesma tela;
- com `prefers-reduced-motion`, manter apenas blink ocasional ou remover.

---

## 5.3. Observando o cursor

A melhor abordagem é mover só os olhos, e mover o corpo muito pouco.

### Exemplo com Motion Values

```tsx
"use client";

import { motion, useMotionValue, useSpring, useTransform } from "motion/react";

export function JitGhostEyes() {
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);

  const eyeX = useSpring(useTransform(pointerX, [-300, 300], [-2, 2]), {
    stiffness: 220,
    damping: 20,
  });

  const eyeY = useSpring(useTransform(pointerY, [-300, 300], [-1.5, 1.5]), {
    stiffness: 220,
    damping: 20,
  });

  return (
    <motion.g style={{ x: eyeX, y: eyeY }}>
      <rect x="138" y="124" width="22" height="26" fill="#F3EFD1" />
      <rect x="188" y="124" width="22" height="26" fill="#F3EFD1" />
    </motion.g>
  );
}
```

### Regra importante

- deslocamento dos olhos: no máximo `2px` a `4px`;
- deslocamento do corpo: no máximo `6px` a `16px`;
- nunca grudar no ponteiro;
- nunca cobrir botões ou inputs.

---

## 5.4. Follow pointer suave

O corpo pode seguir o mouse com atraso, principalmente no hero.

### Exemplo

```tsx
"use client";

import { motion, useMotionValue, useSpring } from "motion/react";
import { useEffect } from "react";

export function JitGhost() {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const springX = useSpring(x, { stiffness: 180, damping: 22, mass: 0.8 });
  const springY = useSpring(y, { stiffness: 180, damping: 22, mass: 0.8 });

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const dx = (event.clientX - window.innerWidth / 2) * 0.02;
      const dy = (event.clientY - window.innerHeight / 2) * 0.015;
      x.set(dx);
      y.set(dy);
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, [x, y]);

  return (
    <motion.div style={{ x: springX, y: springY }}>
      {/* SVG aqui */}
    </motion.div>
  );
}
```

### Recomendação

Use isso apenas:

- no hero;
- em seções demonstrativas;
- nunca em mobile coarse pointer.

---

## 5.5. Entrada na viewport

Quando a seção entra na tela, o fantasminha pode aparecer com:

- fade in;
- leve subida;
- pequena escala.

### Exemplo

```tsx
<motion.div
  initial={{ opacity: 0, y: 16, scale: 0.96 }}
  whileInView={{ opacity: 1, y: 0, scale: 1 }}
  viewport={{ once: true, margin: "-15%" }}
  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
>
  <JitGhost />
</motion.div>
```

---

## 5.6. Compile animation

Quando o usuário clicar em algo como "Generate" ou "Compile":

1. o fantasma inclina;
2. aparece um glow dourado;
3. o corpo vibra pouco;
4. ao final, ele volta ao idle.

### CSS de vibração curta

```css
@keyframes ghostCompile {
  0% { transform: translateX(0); }
  20% { transform: translateX(-1px); }
  40% { transform: translateX(1px); }
  60% { transform: translateX(-1px); }
  80% { transform: translateX(1px); }
  100% { transform: translateX(0); }
}

.compile {
  animation: ghostCompile 280ms steps(2) 2;
}
```

### Sugestão adicional

Adicione um glow com pseudo-elemento:

```css
.compileGlow::after {
  content: "";
  position: absolute;
  inset: -10px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(247,210,126,.22), transparent 70%);
  pointer-events: none;
}
```

---

## 5.7. Success reaction

Depois da compilação:

- bounce curto;
- olhos mais abertos ou brilho;
- talvez uma estrelinha;
- duração curta.

### Motion

```tsx
animate={{ y: [0, -8, 0], scale: [1, 1.04, 1] }}
transition={{ duration: 0.42, ease: "easeOut" }}
```

---

# 6. Boas práticas para performance

## 6.1. Regra principal

A animação deve rodar principalmente em:

- `transform`;
- `opacity`;
- pequenos elementos SVG.

Evite animar:

- `top`;
- `left`;
- `width`;
- `height`;
- `filter` pesado em grandes áreas;
- `box-shadow` gigantes em loop.

## 6.2. Não rerender por ponteiro

No React, não use `setState` em todo `pointermove`.

Prefira:

- `useMotionValue`;
- `useSpring`;
- CSS variables atualizadas com `requestAnimationFrame`;
- `PointerEvent` passivo.

## 6.3. Hidratação seletiva

No Next.js:

- renderize o SVG estático primeiro;
- carregue a versão interativa apenas quando necessário;
- use `dynamic()` para componentes animados pesados.

---

# 7. Acessibilidade

## 7.1. Reduced motion

Sempre respeite:

```css
@media (prefers-reduced-motion: reduce) {
  .float,
  .eyes,
  .compile {
    animation: none !important;
  }
}
```

Nesse modo:

- remova follow cursor;
- remova floating contínuo;
- mantenha apenas aparições suaves ou nada;
- preserve legibilidade.

## 7.2. Elemento decorativo

Se for apenas decorativo:

```tsx
<div aria-hidden="true">
  <JitGhost />
</div>
```

## 7.3. Toggle do usuário

Crie uma preferência do tipo:

- animações completas;
- animações reduzidas;
- ocultar mascote.

Pode salvar em `localStorage`.

---

# 8. Exemplo de componente base

```tsx
"use client";

import { motion } from "motion/react";
import styles from "./jit-ghost.module.css";

interface JitGhostProps {
  state?: "idle" | "compile" | "success";
}

export function JitGhost({ state = "idle" }: JitGhostProps) {
  return (
    <motion.div
      className={[
        styles.ghost,
        state === "idle" && styles.float,
        state === "compile" && styles.compile,
        state === "success" && styles.success,
      ]
        .filter(Boolean)
        .join(" ")}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 320 280" width="160" height="140">
        <g className={styles.body}>
          <path fill="#E6E1C2" d="M98 34h64v12h24v12h18v12h14v12h12v12h10v16h12v72h18v14h-18v12h-32v12H96v14H72v-14H44v-12H20v-14H8v-16h12v-26h12v-74h12V94h10V82h12V70h14V58h18V46h24V34z" />
        </g>

        <g className={styles.eyes}>
          <rect x="138" y="124" width="22" height="26" fill="#F3EFD1" />
          <rect x="188" y="124" width="22" height="26" fill="#F3EFD1" />
        </g>
      </svg>
    </motion.div>
  );
}
```

---

# 9. Recomendações por contexto

## Hero

Use:

- float;
- eyes tracking;
- body parallax leve;
- compile/success em demos.

## Feature cards

Use:

- entrada curta;
- hover leve;
- sem follow pointer global.

## Documentação

Use:

- estado idle;
- blink discreto;
- reação ao copy;
- opção de ocultar.

## Playground

Use:

- compile;
- success;
- warning;
- error;
- typing.

---

# 10. Checklist final

- [ ] O SVG está limpo e isolado.
- [ ] O componente funciona sem depender de canvas.
- [ ] `prefers-reduced-motion` foi implementado.
- [ ] O mascote não cobre conteúdo interativo.
- [ ] O site continua útil sem animação.
- [ ] O follow pointer não causa rerender contínuo.
- [ ] O blink não é excessivo.
- [ ] O compile effect é curto.
- [ ] O mascote pode ser ocultado pelo usuário.
- [ ] As animações usam `transform` e `opacity`.

---

# 11. Resumo prático

Se você quiser a versão mais segura e eficiente:

1. use o SVG como base;
2. aplique `floating` com CSS;
3. mova só os olhos com Motion;
4. use `useSpring` para o corpo seguir levemente o cursor no hero;
5. adicione estados curtos para compile/success;
6. desative tudo em `prefers-reduced-motion`.

Essa combinação já entrega uma experiência muito boa, leve e coerente com a identidade da JIT.
