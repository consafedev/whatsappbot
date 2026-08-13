import "reflect-metadata";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { loadRuntimeConfig } from "@whatsapp-platform/config";

@Controller()
class HealthController {
  @Get("health")
  health(): { service: "api"; status: "ok" } {
    return { service: "api", status: "ok" };
  }
}

@Module({ controllers: [HealthController] })
class AppModule {}

async function bootstrap(): Promise<void> {
  const config = loadRuntimeConfig();
  const app = await NestFactory.create(AppModule);

  await app.listen(config.apiPort, "0.0.0.0");
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown bootstrap error";
  console.error(JSON.stringify({ error: message, service: "api", status: "failed" }));
  process.exitCode = 1;
});
