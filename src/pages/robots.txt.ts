export async function GET() {
  const isPages = process.env.DEPLOY_TARGET === 'pages';
  const body = isPages
    ? 'User-agent: *\nDisallow: /\n'
    : 'User-agent: *\nAllow: /\n';
  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain'
    }
  });
}
