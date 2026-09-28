export const RESOURCES = ['posts', 'comments', 'albums', 'photos', 'users', 'todos'] as const;
export type Resource = (typeof RESOURCES)[number];

// Nested routes documented on https://jsonplaceholder.typicode.com/
export const NESTED: ReadonlyArray<{ parent: Resource; child: Resource }> = [
  { parent: 'posts', child: 'comments' },
  { parent: 'albums', child: 'photos' },
  { parent: 'users', child: 'albums' },
  { parent: 'users', child: 'todos' },
  { parent: 'users', child: 'posts' },
];
