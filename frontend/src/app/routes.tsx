import type { RouteObject } from 'react-router'
import { ErrorPage } from '../pages/ErrorPage'
import { FieldSetupPage } from '../pages/FieldSetupPage'
import { LogPage } from '../pages/LogPage'
import { MapPage } from '../pages/MapPage'
import { MorePage } from '../pages/MorePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { PlotPage } from '../pages/PlotPage'
import { SpeciesPage } from '../pages/SpeciesPage'
import { StatsPage } from '../pages/StatsPage'
import { TasksPage } from '../pages/TasksPage'
import { ZonePage } from '../pages/ZonePage'
import { Layout } from './Layout'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <MapPage /> },
      { path: 'log', element: <LogPage /> },
      { path: 'species', element: <SpeciesPage /> },
      { path: 'stats', element: <StatsPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'zones/:id', element: <ZonePage /> },
      { path: 'plots/:id', element: <PlotPage /> },
      { path: 'field', element: <FieldSetupPage /> },
      { path: 'more', element: <MorePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
