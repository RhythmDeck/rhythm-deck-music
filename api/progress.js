export async function GET(req) {
  const fileId = req.nextUrl.searchParams.get('fileId');
  // For simplicity we return fake progress. You can improve later with Redis or DB.
  return Response.json({ progress: 100 });
}// JavaScript Document