export default async () => {
  return new Response(
    JSON.stringify({
      url: Deno.env.get("SUPABASE_URL"),
      anon: Deno.env.get("SUPABASE_ANON")
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
};
