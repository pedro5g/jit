import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { AOT, JIT } from "../../index.js";
import { registerAotTestHooks } from "./aot-test-utils.js";

let outDir: string;
registerAotTestHooks((directory) => {
  outDir = directory;
});

it("should emit aggregate timestamp mutations without the runtime", async () => {
  const OrderBase = JIT.ddd
    .aggregateRoot(
      JIT.object({
        id: JIT.string(),
        status: JIT.string(),
        updatedAt: JIT.date(),
      }),
      { id: "id" }
    )
    .extends(JIT.ddd.timestamps({ updatedAt: "updatedAt" }));
  AOT.generate({ groups: {}, artifacts: { OrderBase }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly OrderBase: {
      create(input: { id: string; status: string; updatedAt: Date }): {
        readonly _props: { status: string };
        touch(): void;
        updatedAt: Date;
      };
    };
  };
  const initial = new Date(0);
  const order = generated.OrderBase.create({ id: "o_1", status: "draft", updatedAt: initial });

  order._props.status = "confirmed";
  order.touch();
  expect(order.updatedAt.getTime()).toBeGreaterThan(initial.getTime());
  const mutatedAt = order.updatedAt;
  order.touch();
  expect(order.updatedAt.getTime()).toBeGreaterThanOrEqual(mutatedAt.getTime());
});

it("should emit soft-delete metadata with a shared timestamp instant", async () => {
  const OrderBase = JIT.ddd
    .aggregateRoot(
      JIT.object({
        id: JIT.string(),
        updatedAt: JIT.date(),
        deletedAt: JIT.date().nullable(),
      }),
      { id: "id" }
    )
    .extends(JIT.ddd.timestamps({ updatedAt: "updatedAt" }), JIT.ddd.softDelete({ field: "deletedAt" }));
  AOT.generate({ groups: {}, artifacts: { OrderBase }, outDir });
  const generated = (await import(pathToFileURL(join(outDir, "index.js")).href)) as {
    readonly OrderBase: {
      create(input: { id: string; updatedAt: Date; deletedAt: Date | null }): {
        softDelete(): void;
        restore(): void;
        readonly isDeleted: boolean;
        updatedAt: Date;
        deletedAt: Date | null;
      };
    };
  };
  const order = generated.OrderBase.create({ id: "o_1", updatedAt: new Date(0), deletedAt: null });

  order.softDelete();
  expect(order.isDeleted).toBe(true);
  expect(order.deletedAt).toBe(order.updatedAt);
  order.restore();
  expect(order.isDeleted).toBe(false);
});
