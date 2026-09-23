import { throttle } from "@/core/auth";
import { listDriverUnitPhotos, uploadDriverUnitPhoto } from "@/core/unit-photos";
import { mobilePrincipal } from "@/server/driver-mobile-http";
import { endpoint, json } from "@/server/http";
import { unitPhotoBody } from "@/server/unit-photo-body";

type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    return json(await listDriverUnitPhotos(pool, driver.driver_id, (await context.params).id, config.timezone));
  });
}

export function POST(request: Request, context: Context) {
  return endpoint(async () => {
    const { pool, config, driver } = await mobilePrincipal(request);
    await throttle(pool, `unit-photo:${driver.driver_id}`, 30);
    const { bytes, contentType } = await unitPhotoBody(request);
    return json(
      await uploadDriverUnitPhoto(pool, driver.driver_id, (await context.params).id, bytes, contentType, config.timezone),
      201,
    );
  });
}
