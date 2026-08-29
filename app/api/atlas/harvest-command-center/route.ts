import { NextResponse } from "next/server";

import { getAtlasSession } from "@/lib/atlas/session";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type MembershipRow = { id: string; farm_id: string; role: string; worker_key: string | null };
type RouteRow = { id: string; farm_id: string; route_date: string; route_label: string; assigned_membership_id: string | null; custodian_label: string | null; note: string | null; created_at: string };
type RoutePositionRow = {
  prospect_route_id: string; farm_id: string; route_date: string; route_label: string; assigned_membership_id: string | null;
  prospect_route_line_id: string; ready_lot_id: string; inventory_kind: string; crop_profile_id: string | null; crop_label: string | null;
  variety: string | null; product_label: string | null; quantity: number | string; unit: string; destination_label: string | null;
  prospect_state: string; created_at: string; released_quantity: number | string; on_prospect_route_quantity: number | string;
  returned_quantity: number | string; sold_quantity: number | string; other_released_quantity: number | string;
};
type InventoryPositionRow = {
  id: string; farm_id: string; preparation_batch_id: string; inventory_kind: string; unit: string; ready_date: string;
  birth_quantity: number | string; active_claimed_quantity: number | string; fulfilled_quantity: number | string;
  disposed_quantity: number | string; available_quantity: number | string; crop_profile_id: string | null; product_label: string | null;
  on_prospect_route_quantity: number | string;
};

type Json = Record<string, unknown>;
function number(value: unknown) { const parsed = typeof value === "number" ? value : Number(value ?? 0); return Number.isFinite(parsed) ? parsed : 0; }
function privateJson(body: Json, status = 200) { return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }
function memberLabel(member: MembershipRow | undefined) {
  if (!member) return "Atlas member";
  if (member.worker_key) return member.worker_key.charAt(0).toUpperCase() + member.worker_key.slice(1);
  return member.role === "owner" ? "Owner" : member.role === "manager" ? "Manager" : "Farm hand";
}

export async function GET() {
  const session = await getAtlasSession();
  if (!session) return privateJson({ ok: false, error: "unauthorized" }, 401);
  const supabase = await createAtlasServerClient();
  const farmIds = Array.from(new Set(session.memberships.map((membership) => membership.farmId)));

  const [membershipsResult, positionsResult, routesResult, routePositionsResult] = await Promise.all([
    supabase.from("farm_memberships").select("id, farm_id, role, worker_key").in("farm_id", farmIds).eq("active", true),
    supabase.from("flower_ready_inventory_position_v1").select("id, farm_id, preparation_batch_id, inventory_kind, unit, ready_date, birth_quantity, active_claimed_quantity, fulfilled_quantity, disposed_quantity, available_quantity, crop_profile_id, product_label, on_prospect_route_quantity").in("farm_id", farmIds),
    supabase.from("flower_prospect_routes").select("id, farm_id, route_date, route_label, assigned_membership_id, custodian_label, note, created_at").in("farm_id", farmIds).order("created_at", { ascending: false }),
    supabase.from("flower_prospect_route_position_v1").select("prospect_route_id, farm_id, route_date, route_label, assigned_membership_id, prospect_route_line_id, ready_lot_id, inventory_kind, crop_profile_id, crop_label, variety, product_label, quantity, unit, destination_label, prospect_state, created_at, released_quantity, on_prospect_route_quantity, returned_quantity, sold_quantity, other_released_quantity").in("farm_id", farmIds).order("created_at", { ascending: false }),
  ]);

  if (membershipsResult.error || positionsResult.error || routesResult.error || routePositionsResult.error) {
    console.error("Harvest command center read failed.", membershipsResult.error || positionsResult.error || routesResult.error || routePositionsResult.error);
    return privateJson({ ok: false, error: "Flower movement state could not be loaded." }, 500);
  }

  const memberships = (membershipsResult.data ?? []) as MembershipRow[];
  const positions = (positionsResult.data ?? []) as InventoryPositionRow[];
  const routes = (routesResult.data ?? []) as RouteRow[];
  const routePositions = (routePositionsResult.data ?? []) as RoutePositionRow[];
  const memberById = new Map(memberships.map((row) => [row.id, row]));

  const farms = farmIds.map((farmId) => {
    const farmRoutes = routes.filter((route) => route.farm_id === farmId).map((route) => {
      const lines = routePositions.filter((line) => line.prospect_route_id === route.id).map((line) => ({
        id: line.prospect_route_line_id,
        readyLotId: line.ready_lot_id,
        productLabel: line.product_label?.trim() || line.crop_label?.trim() || line.inventory_kind.replace(/_/g, " "),
        inventoryKind: line.inventory_kind,
        quantity: number(line.quantity),
        unit: line.unit,
        destinationLabel: line.destination_label,
        state: line.prospect_state,
        onRouteQuantity: number(line.on_prospect_route_quantity),
        soldQuantity: number(line.sold_quantity),
        returnedQuantity: number(line.returned_quantity),
        otherReleasedQuantity: number(line.other_released_quantity),
      }));
      const custodian = route.custodian_label?.trim() || memberLabel(route.assigned_membership_id ? memberById.get(route.assigned_membership_id) : undefined);
      return {
        id: route.id,
        routeDate: route.route_date,
        routeLabel: route.route_label,
        assignedMembershipId: route.assigned_membership_id,
        custodianLabel: custodian,
        custodianKind: route.assigned_membership_id ? "farm_member" : "external_person",
        note: route.note,
        createdAt: route.created_at,
        lines,
        activeQuantity: lines.reduce((sum, line) => sum + line.onRouteQuantity, 0),
        soldQuantity: lines.reduce((sum, line) => sum + line.soldQuantity, 0),
        returnedQuantity: lines.reduce((sum, line) => sum + line.returnedQuantity, 0),
      };
    });

    return {
      id: farmId,
      lotPositions: positions.filter((row) => row.farm_id === farmId).map((row) => ({
        readyLotId: row.id,
        preparationBatchId: row.preparation_batch_id,
        productLabel: row.product_label,
        inventoryKind: row.inventory_kind,
        unit: row.unit,
        readyDate: row.ready_date,
        birthQuantity: number(row.birth_quantity),
        claimedQuantity: number(row.active_claimed_quantity),
        fulfilledQuantity: number(row.fulfilled_quantity),
        disposedQuantity: number(row.disposed_quantity),
        onRouteQuantity: number(row.on_prospect_route_quantity),
        availableQuantity: number(row.available_quantity),
      })),
      routes: farmRoutes,
      activeRoutes: farmRoutes.filter((route) => route.activeQuantity > 0),
      members: memberships.filter((member) => member.farm_id === farmId).map((member) => ({ id: member.id, role: member.role, workerKey: member.worker_key, displayName: memberLabel(member) })),
    };
  });

  return privateJson({ ok: true, contractVersion: "harvest_command_center_v1", farms });
}
