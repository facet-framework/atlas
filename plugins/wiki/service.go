package wiki

import (
	"encoding/json"
	"errors"
	"net/http"
	"sync"

	content "github.com/facet-framework/atlas/plugins/wiki/internal/wiki"
	"github.com/facet-framework/core/corpus"
	"github.com/facet-framework/core/registry"
)

type Service struct {
	Registry facet.Registry
	broker   *facet.PluginBroker
	sessions repoSessions
	toolMu   sync.Mutex
}

func RegisterCorpus() {
	content.Register()
	corpus.RegisterSection("wiki", func(reg facet.Registry) (any, bool) {
		wiki := content.BuildCorpus(reg)
		return wiki, wiki != nil
	})
}

func NewService(reg facet.Registry, broker *facet.PluginBroker) *Service {
	return &Service{Registry: reg, broker: broker}
}

func (s *Service) Tools() map[string]func(json.RawMessage) (any, error) {
	tools := map[string]func(json.RawMessage) (any, error){
		"repo.state": s.hostRepoState, "repo.log": s.hostRepoLog, "repo.branch": s.hostRepoBranch,
		"repo.write": s.hostRepoWrite, "repo.commit": s.hostRepoCommit, "repo.pr": s.hostRepoPR,
	}
	for name, run := range tools {
		tools[name] = func(args json.RawMessage) (any, error) {
			s.toolMu.Lock()
			defer s.toolMu.Unlock()
			return run(args)
		}
	}
	return tools
}

func (s *Service) Routes() map[string]http.HandlerFunc {
	return map[string]http.HandlerFunc{
		"GET " + ConfluenceStatePath: s.confluenceState,
		"GET " + ConfluenceReachPath: s.confluenceReach,
	}
}

func (s *Service) Close() error {
	s.toolMu.Lock()
	defer s.toolMu.Unlock()
	var result error
	for name, state := range s.sessions.by {
		result = errors.Join(result, state.session.Close())
		delete(s.sessions.by, name)
	}
	return result
}
