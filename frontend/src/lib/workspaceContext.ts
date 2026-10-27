import { createContext, useContext } from 'react'
import type { Workspace } from './workspaces'
export const WorkspaceContext = createContext<Workspace | undefined>(undefined)
export const useWorkspace = () => useContext(WorkspaceContext)
