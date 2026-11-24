package controller

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
	"golang.org/x/oauth2"

	"github.com/nezhahq/nezha/model"
	"github.com/nezhahq/nezha/service/singleton"
)

// GHSA-9rc6-8cjv-rcvx: the OAuth2 callback URL is sent to the identity
// provider and is where the authorization code lands. Deriving it from the
// raw Host header lets an attacker who can reach this handler with a forged
// Host (or a provider with loose redirect-URI matching) divert a victim's
// code to their own origin and bind the victim's identity. A request Host is
// trusted only when it is an operator-declared dashboard host (the same
// allowlist that guards NAT routing). Otherwise the redirect is pinned to the
// operator-declared DashboardHost. Empty DashboardHost intentionally retains
// dynamic/multi-domain deployments by passing through request Host; those
// deployments must validate Host at their trusted proxy and register exact
// redirect URIs at the OAuth provider. GHSA-rf68-8gjr-36q7 documents this
// configuration boundary and must be updated if this compatibility changes.
func getRedirectURL(c *gin.Context) string {
	scheme := "http://"
	referer := c.Request.Referer()
	if forwardedProto := c.Request.Header.Get("X-Forwarded-Proto"); forwardedProto == "https" || strings.HasPrefix(referer, "https://") {
		scheme = "https://"
	}
	host := c.Request.Host
	if singleton.Conf != nil {
		// Check reservations and canonical host from one committed configuration.
		policy := singleton.Conf.NATDomainPolicySnapshot()
		if !policy.IsReservedHost(host) && policy.DashboardHost != "" {
			host = policy.DashboardHost
		}
	}
	return scheme + host + "/api/v1/oauth2/callback"
}

// @Summary Get Oauth2 Redirect URL
// @Description Get Oauth2 Redirect URL
// @Produce json
// @Param provider path string true "provider"
// @Param type query int false "type" Enums(1, 2) default(1)
// @Success 200 {object} model.Oauth2LoginResponse
// @Router /api/v1/oauth2/{provider} [get]
func oauth2redirect(c *gin.Context) (*model.Oauth2LoginResponse, error) {
	return nil, fmt.Errorf("OAuth2 登录已关闭，请使用 Passkey 登录")
}

// writeOauth2StateCookie sets the nz-o2s cookie used to authenticate the
// OAuth2 callback. Secure is set when the request arrives over HTTPS;
// HttpOnly is enabled unconditionally — the frontend does not read this
// cookie, only the dashboard's callback handler does, so HTTP-only access
// is strictly an XSS-hardening win.
func writeOauth2StateCookie(c *gin.Context, stateKey string) {
	secure := c.Request.URL.Scheme == "https" || c.Request.TLS != nil
	c.SetCookie("nz-o2s", stateKey, 60*5, "", "", secure, true)
}

// @Summary Unbind Oauth2
// @Description Unbind Oauth2
// @Accept json
// @Produce json
// @Param provider path string true "provider"
// @Success 200 {object} any
// @Router /api/v1/oauth2/{provider}/unbind [post]
func unbindOauth2(c *gin.Context) (any, error) {
	provider := c.Param("provider")
	if provider == "" {
		return nil, singleton.Localizer.ErrorT("provider is required")
	}
	_, has := singleton.Conf.Oauth2[provider]
	if !has {
		return nil, singleton.Localizer.ErrorT("provider not found")
	}
	provider = strings.ToLower(provider)

	u := c.MustGet(model.CtxKeyAuthorizedUser).(*model.User)
	query := singleton.DB.Where("provider = ? AND user_id = ?", provider, u.ID)

	var bindCount int64
	if err := query.Model(&model.Oauth2Bind{}).Count(&bindCount).Error; err != nil {
		return nil, newGormError("%v", err)
	}

	if bindCount < 2 && u.RejectPassword {
		return nil, singleton.Localizer.ErrorT("operation not permitted")
	}

	if err := query.Delete(&model.Oauth2Bind{}).Error; err != nil {
		return nil, newGormError("%v", err)
	}

	return nil, nil
}

// @Summary Oauth2 Callback
// @Description Oauth2 Callback
// @Accept json
// @Produce json
// @Param state query string true "state"
// @Param code query string true "code"
// @Success 200 {object} model.CommonResponse[any]
// @Router /api/v1/oauth2/callback [get]
// @Router /api/v1/oauth2/callback/{provider} [get]
func oauth2callback(jwtConfig *jwt.GinJWTMiddleware) func(c *gin.Context) (any, error) {
	return func(c *gin.Context) (any, error) {
		return nil, fmt.Errorf("OAuth2 登录已关闭，请使用 Passkey 登录")
	}
}

// oauth2ProviderHTTPClient calls only the token_url and user_info_url the
// operator configured. Without it golang.org/x/oauth2 falls back to
// http.DefaultClient, which follows redirects: the provider's answer would
// then choose the next address the Dashboard calls (loopback, private ranges,
// metadata services), the bearer token or client secret would be sent there,
// and the answer would be taken as the token or userinfo document. The
// addresses themselves are not filtered as in utils.NewRestrictedHTTPClient,
// because a provider may legitimately live on a private network. The timeout
// is the one pkg/utils sets on http.DefaultClient.
var oauth2ProviderHTTPClient = &http.Client{
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	},
	Timeout: time.Minute * 10,
}

func exchangeOpenId(c *gin.Context, o2confRaw *model.Oauth2Config,
	callbackData *model.Oauth2Callback, redirectURL string) (string, error) {
	o2conf := o2confRaw.Setup(redirectURL)
	ctx := context.WithValue(c, oauth2.HTTPClient, oauth2ProviderHTTPClient)

	otk, err := o2conf.Exchange(ctx, callbackData.Code)
	if err != nil {
		return "", err
	}
	oauth2client := o2conf.Client(ctx, otk)
	resp, err := oauth2client.Get(o2confRaw.UserInfoURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	// Provider error payloads are not identities, even if they contain an id field.
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("userinfo returned HTTP %d", resp.StatusCode)
	}
	const maxUserInfoSize = 1 << 20
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxUserInfoSize+1))
	if err != nil {
		return "", err
	}

	// gjson.ValidBytes recurses once per nesting level with no depth limit, so a body of
	// "[" within the size cap grows this goroutine's stack to over 100 MiB. json.Valid
	// does not recurse and rejects documents nested deeper than 10000 levels.
	if len(body) > maxUserInfoSize || !json.Valid(body) {
		return "", fmt.Errorf("invalid or oversized userinfo response")
	}
	id := gjson.GetBytes(body, o2confRaw.UserIDPath)
	if (id.Type != gjson.String && id.Type != gjson.Number) || strings.TrimSpace(id.String()) == "" {
		return "", fmt.Errorf("userinfo contains no valid user identifier")
	}
	return id.String(), nil
}

var oauthStateConsumeMu sync.Mutex

func verifyState(c *gin.Context, state string) (*model.Oauth2State, error) {
	// Get+Delete must be atomic: concurrent callbacks cannot both consume one state.
	oauthStateConsumeMu.Lock()
	defer oauthStateConsumeMu.Unlock()
	// 验证登录跳转时的 State
	stateKey, err := c.Cookie("nz-o2s")
	if err != nil {
		return nil, singleton.Localizer.ErrorT("invalid state key")
	}

	cacheKey := fmt.Sprintf("%s%s", model.CacheKeyOauth2State, stateKey)
	istate, ok := singleton.Cache.Get(cacheKey)
	if !ok {
		return nil, singleton.Localizer.ErrorT("invalid state key")
	}

	oauth2State, ok := istate.(*model.Oauth2State)
	if !ok || oauth2State.State != state {
		return nil, singleton.Localizer.ErrorT("invalid state key")
	}

	if oauth2State.Action == model.RTypeBind {
		user, ok := c.Get(model.CtxKeyAuthorizedUser)
		if !ok || oauth2State.UserID == 0 || user.(*model.User).ID != oauth2State.UserID || oauth2State.SessionID == "" || c.GetString(jwtClaimKeyID) != oauth2State.SessionID {
			return nil, singleton.Localizer.ErrorT("unauthorized")
		}
	}
	singleton.Cache.Delete(cacheKey)
	return oauth2State, nil
}
