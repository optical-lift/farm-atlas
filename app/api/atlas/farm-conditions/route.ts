import { NextRequest } from "next/server";
import { GET as readFarmWeatherRain, POST as writeFarmRain } from "../farm-weather-rain/route";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return readFarmWeatherRain(request);
}

export async function POST(request: NextRequest) {
  return writeFarmRain(request);
}
