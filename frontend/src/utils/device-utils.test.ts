import { describe, expect, test } from "vitest";
import type { DeviceConfig, HomeAssistant } from "../types";
import {
  deviceAbilities,
  deviceSetpointOffset,
  deviceSetpointOffsetSides,
  modeFits,
} from "./device-utils";

const ac = (entity_id: string) => ({ entity_id, type: "ac", role: "auto" }) as DeviceConfig;
const trv = (entity_id: string) => ({ entity_id, type: "trv", role: "auto" }) as DeviceConfig;

function hassWith(modes: Record<string, string[] | undefined>): Pick<HomeAssistant, "states"> {
  const states: Record<string, unknown> = {};
  for (const [eid, m] of Object.entries(modes)) {
    states[eid] = { entity_id: eid, state: "off", attributes: m ? { hvac_modes: m } : {} };
  }
  return { states } as unknown as Pick<HomeAssistant, "states">;
}

describe("deviceAbilities", () => {
  test("reads heat and cool from the AC's hvac_modes", () => {
    const hass = hassWith({ "climate.ac": ["off", "cool", "dry"] });
    expect(deviceAbilities([ac("climate.ac")], hass)).toEqual({
      heat: false,
      cool: true,
      mixed: false,
    });
  });

  test("a heat pump split heats and cools", () => {
    const hass = hassWith({ "climate.ac": ["off", "heat", "cool"] });
    const ability = deviceAbilities([ac("climate.ac")], hass);
    expect(ability.heat && ability.cool).toBe(true);
  });

  test("modes without any active one count as able, like the backend (#100)", () => {
    const hass = hassWith({ "climate.zone": ["off", "fan_only"] });
    const ability = deviceAbilities([ac("climate.zone")], hass);
    expect(ability).toEqual({ heat: true, cool: true, mixed: false });
    expect(modeFits("heat_only", [ac("climate.zone")], ability)).toBe(true);
  });

  test("a device without state or modes counts as able", () => {
    const ability = deviceAbilities([ac("climate.gone")], hassWith({}));
    expect(ability.heat && ability.cool).toBe(true);
  });

  test("a thermostat heats, never cools", () => {
    const hass = hassWith({ "climate.trv": ["heat"] });
    expect(deviceAbilities([trv("climate.trv")], hass)).toEqual({
      heat: true,
      cool: false,
      mixed: false,
    });
  });
});

describe("deviceSetpointOffset", () => {
  test("reads split heat and cool offsets independently", () => {
    const dev: DeviceConfig = {
      ...ac("climate.ac"),
      setpoint_mode: "direct",
      setpoint_offset_heat: 3,
      setpoint_offset_cool: -2,
    };
    expect(deviceSetpointOffset(dev, "heat")).toBe(3);
    expect(deviceSetpointOffset(dev, "cool")).toBe(-2);
  });

  test("falls back to legacy setpoint_offset for unmigrated configs", () => {
    const devAc: DeviceConfig = { ...ac("climate.ac"), setpoint_offset: 1.5 };
    expect(deviceSetpointOffset(devAc, "heat")).toBe(1.5);
    expect(deviceSetpointOffset(devAc, "cool")).toBe(1.5);

    const devTrv: DeviceConfig = { ...trv("climate.trv"), setpoint_offset: 2 };
    expect(deviceSetpointOffset(devTrv, "heat")).toBe(2);
    expect(deviceSetpointOffset(devTrv, "cool")).toBe(0);
  });

  test("explicit zero overrides legacy setpoint_offset", () => {
    const dev: DeviceConfig = {
      ...ac("climate.ac"),
      setpoint_offset: 2,
      setpoint_offset_heat: 3,
      setpoint_offset_cool: 0,
    };
    expect(deviceSetpointOffset(dev, "heat")).toBe(3);
    expect(deviceSetpointOffset(dev, "cool")).toBe(0);
  });
});

describe("deviceSetpointOffsetSides", () => {
  test("reverse-cycle AC offers both heat and cool offsets", () => {
    const hass = hassWith({ "climate.ac": ["off", "heat", "cool", "auto"] });
    expect(deviceSetpointOffsetSides(ac("climate.ac"), hass)).toEqual({
      heat: true,
      cool: true,
    });
  });

  test("cool-only AC offers only cooling offset unless heat offset is non-zero", () => {
    const hass = hassWith({ "climate.ac": ["off", "cool", "dry"] });
    expect(deviceSetpointOffsetSides(ac("climate.ac"), hass)).toEqual({
      heat: false,
      cool: true,
    });
    expect(
      deviceSetpointOffsetSides({ ...ac("climate.ac"), setpoint_offset_heat: 1 }, hass),
    ).toEqual({ heat: true, cool: true });
  });

  test("heat-only AC offers only heating offset unless cool offset is non-zero", () => {
    const hass = hassWith({ "climate.ac": ["off", "heat"] });
    expect(deviceSetpointOffsetSides(ac("climate.ac"), hass)).toEqual({
      heat: true,
      cool: false,
    });
    expect(
      deviceSetpointOffsetSides({ ...ac("climate.ac"), setpoint_offset_cool: -1 }, hass),
    ).toEqual({ heat: true, cool: true });
  });

  test("TRV only offers heating offset", () => {
    const hass = hassWith({ "climate.trv": ["off", "heat"] });
    expect(deviceSetpointOffsetSides(trv("climate.trv"), hass)).toEqual({
      heat: true,
      cool: false,
    });
  });
});
