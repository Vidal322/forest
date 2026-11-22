import type { RouteObject } from 'react-router'
import { ErrorPage } from '../pages/ErrorPage'
import { FieldSetupPage } from '../pages/FieldSetupPage'
import { MapPage } from '../pages/MapPage'
import { MorePage } from '../pages/MorePage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { SpeciesPage } from '../pages/SpeciesPage'
import { Layout } from './Layout'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <MapPage /> },
      { path: 'species', element: <SpeciesPage /> },
      { path: 'field', element: <FieldSetupPage /> },
      { path: 'more', element: <MorePage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
