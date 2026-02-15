# Frontend Specification

## Architecture

```
frontend/
├── src/
│   ├── api/
│   │   └── client.ts             # API client with auth handling
│   ├── components/
│   │   ├── layout/
│   │   │   ├── app-layout.tsx     # Main layout with sidebar
│   │   │   ├── sidebar.tsx        # Category navigation sidebar
│   │   │   └── top-bar.tsx        # Search, filters, actions
│   │   ├── messages/
│   │   │   ├── message-card.tsx   # Individual message card with animations
│   │   │   ├── message-grid.tsx   # Responsive grid of message cards
│   │   │   ├── message-detail.tsx # Expanded message view/modal
│   │   │   └── bulk-actions.tsx   # Bulk select/delete/move toolbar
│   │   ├── categories/
│   │   │   ├── category-badge.tsx # Category pill with icon + color
│   │   │   └── move-dialog.tsx    # Move message to category dialog
│   │   ├── tags/
│   │   │   ├── tag-badge.tsx      # Tag pill
│   │   │   ├── tag-input.tsx      # Add/remove tags on a message
│   │   │   └── tag-filter.tsx     # Filter messages by tags
│   │   ├── auth/
│   │   │   ├── connect-form.tsx   # Telegram connection form
│   │   │   └── verify-code.tsx    # 2FA code input
│   │   ├── scan/
│   │   │   └── scan-progress.tsx  # Scan progress indicator
│   │   └── ui/                    # shadcn/ui primitives
│   ├── hooks/
│   │   ├── use-messages.ts        # Message CRUD hooks
│   │   └── use-categories.ts      # Category hooks
│   ├── stores/
│   │   ├── auth-store.ts          # Connection state
│   │   ├── messages-store.ts      # Messages, filters, search
│   │   └── ui-store.ts            # UI state (sidebar, modals)
│   ├── lib/
│   │   └── utils.ts               # Utility functions
│   ├── types/
│   │   └── index.ts               # TypeScript type definitions
│   ├── App.tsx                    # Router setup
│   └── main.tsx                   # Entry point
├── tests/
│   ├── setup.ts                   # Test setup (msw, etc.)
│   ├── message-card.test.tsx
│   ├── message-grid.test.tsx
│   ├── sidebar.test.tsx
│   └── api-client.test.ts
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

## Pages / Routes

1. **`/`** — Dashboard: shows all categories with counts, recent messages
2. **`/messages`** — All messages (default view, filterable)
3. **`/messages?category=<slug>`** — Filtered by category
4. **`/connect`** — Telegram connection setup (shown if not connected)

## Message Card Design

Each message card shows:
- **Category badge** (top-left, colored pill with icon)
- **Date** (top-right, relative like "2 hours ago")
- **Content preview** — text snippet or media type indicator
- **URL preview** — if the message contains a link, show domain
- **Media thumbnail** — placeholder icon for media type
- **Tags** — list of tag pills below content
- **Actions** — three-dot menu: Move, Tag, Delete
- **Selection checkbox** — appears on hover or in bulk-select mode

### Animations (Framer Motion)
- **Enter**: Cards fade in + slide up on initial load (`initial={{ opacity: 0, y: 20 }}`)
- **Exit**: Cards fade out + shrink on delete (`exit={{ opacity: 0, scale: 0.95 }}`)
- **Layout**: Smooth reflow when cards are added/removed (`layout` prop)
- **Hover**: Subtle lift + shadow increase
- **Drag**: Cards can be dragged to category sidebar items to move

## Search & Filter

- **Search bar**: Full-text search across message content, URLs, sender names
- **Category filter**: Click sidebar category or dropdown
- **Tag filter**: Multi-select tag pills
- **Sort**: Date (newest/oldest), category, sender
- **Clear filters** button when any filter is active

## Responsive Design

- **Desktop**: Sidebar + 3-4 column card grid
- **Tablet**: Collapsible sidebar + 2 column grid
- **Mobile**: Bottom sheet categories + single column cards

## Testing

- Use Vitest + React Testing Library
- MSW (Mock Service Worker) for API mocking
- Test card rendering, search filtering, category navigation
- ≥80% code coverage
