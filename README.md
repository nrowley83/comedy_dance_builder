import { supabase } from "./supabase";

const mapPerson = (r) => ({ id: r.id, name: r.name });
const mapPiece = (r) => ({ id: r.id, name: r.name, length: r.length_seconds, type: r.type || "normal" });
const mapTrack = (r) => ({ id: r.id, name: r.name, pieceId: r.piece_id });
const mapCostume = (r) => ({ id: r.id, name: r.name, pieceId: r.piece_id });
const mapAssignment = (r) => ({ id: r.id, personId: r.person_id, trackId: r.track_id });

function check(res) {
  if (res.error) throw res.error;
  return res.data;
}

export async function fetchAll() {
  const [people, pieces, tracks, costumes, assignments] = await Promise.all([
    supabase.from("people").select("*").order("name"),
    supabase.from("pieces").select("*").order("name"),
    supabase.from("tracks").select("*"),
    supabase.from("costumes").select("*"),
    supabase.from("assignments").select("*"),
  ]);
  return {
    people: check(people).map(mapPerson),
    pieces: check(pieces).map(mapPiece),
    tracks: check(tracks).map(mapTrack),
    costumes: check(costumes).map(mapCostume),
    assignments: check(assignments).map(mapAssignment),
  };
}

export async function addPerson(name) {
  return mapPerson(check(await supabase.from("people").insert({ name }).select().single()));
}
export async function deletePerson(id) {
  check(await supabase.from("people").delete().eq("id", id));
}

export async function addPiece(name, length, type = "normal") {
  return mapPiece(check(await supabase.from("pieces").insert({ name, length_seconds: length, type }).select().single()));
}
export async function updatePieceType(id, type) {
  return mapPiece(check(await supabase.from("pieces").update({ type }).eq("id", id).select().single()));
}
export async function deletePiece(id) {
  check(await supabase.from("pieces").delete().eq("id", id));
}

export async function addTrack(name, pieceId) {
  return mapTrack(check(await supabase.from("tracks").insert({ name, piece_id: pieceId }).select().single()));
}
export async function deleteTrack(id) {
  check(await supabase.from("tracks").delete().eq("id", id));
}

export async function addCostume(name, pieceId) {
  return mapCostume(check(await supabase.from("costumes").insert({ name, piece_id: pieceId }).select().single()));
}
export async function deleteCostume(id) {
  check(await supabase.from("costumes").delete().eq("id", id));
}

export async function addAssignment(personId, trackId) {
  return mapAssignment(check(await supabase.from("assignments").insert({ person_id: personId, track_id: trackId }).select().single()));
}
export async function deleteAssignment(id) {
  check(await supabase.from("assignments").delete().eq("id", id));
}
